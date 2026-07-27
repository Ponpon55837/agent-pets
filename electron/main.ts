import { app, BrowserWindow, screen, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import { createEventServer } from './event-server'
import {
  hookScriptDeployPath,
  ensureDir,
  writeFileEnsured,
  fileExists,
  readFile,
  openCodeCliPluginPath,
  openCodeDesktopPluginPath,
  codexHooksPath,
  codexConfigPath,
  claudeDesktopConfigPath,
  hookScriptPath,
} from './setup'

let petWindow: BrowserWindow | null = null
let anchorBottomCenter: { x: number; y: number } | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function sanitizePetId(id: string): string | null {
  if (typeof id !== 'string') return null
  const cleaned = id.replace(/[^a-zA-Z0-9_\-.]/g, '')
  if (cleaned.length === 0 || cleaned.length > 64) return null
  if (cleaned.includes('..')) return null
  return cleaned
}

function safeJoin(base: string, ...parts: string[]): string | null {
  const resolved = resolve(base, ...parts)
  if (!resolved.startsWith(resolve(base))) return null
  return resolved
}

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const rawScale = parseFloat(process.env.PET_SCALE || '1')
  const scale = clamp(isNaN(rawScale) ? 1 : rawScale, 0.3, 5)
  const w = Math.round(210 * scale)
  const h = Math.round(230 * scale)

  petWindow = new BrowserWindow({
    width: w,
    height: h,
    x: screenWidth - w - 30,
    y: screenHeight - h - 30,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  petWindow.setIgnoreMouseEvents(false)

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    petWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    petWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  petWindow.on('closed', () => {
    petWindow = null
    anchorBottomCenter = null
  })
}

function getPetsJsonPath(): string {
  if (app.isPackaged) {
    return join(app.getAppPath(), 'dist', 'pets', 'pets.json')
  }
  return join(__dirname, '..', 'dist', 'pets', 'pets.json')
}

app.whenReady().then(() => {
  createPetWindow()

  if (petWindow) {
    createEventServer(petWindow)
  }

  ipcMain.on('pet-move', (_event, { dx, dy }) => {
    if (!petWindow) return
    const [x, y] = petWindow.getPosition()
    petWindow.setPosition(x + dx, y + dy)
    anchorBottomCenter = null
  })

  ipcMain.on('pet-resize', (_event, { width, height }) => {
    if (!petWindow) return
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

    if (!anchorBottomCenter) {
      const [x, y] = petWindow.getPosition()
      const [curW, curH] = petWindow.getSize()
      anchorBottomCenter = {
        x: x + Math.round(curW / 2),
        y: y + curH,
      }
    }

    let newX = anchorBottomCenter.x - Math.round(width / 2)
    let newY = anchorBottomCenter.y - height

    newX = clamp(newX, 0, screenW - width)
    newY = clamp(newY, 0, screenH - height)

    petWindow.setBounds({ x: newX, y: newY, width, height })

    anchorBottomCenter = {
      x: newX + Math.round(width / 2),
      y: newY + height,
    }
  })

  ipcMain.on('pet-quit', () => {
    app.quit()
  })

  ipcMain.handle('integration-status', () => {
    const codexConfig = readFile(codexConfigPath())
    return {
      opencode: {
        cli: fileExists(openCodeCliPluginPath()),
        desktop: fileExists(openCodeDesktopPluginPath()),
      },
      codex: {
        hooks: fileExists(codexHooksPath()),
        enabled: codexConfig?.includes('codex_hooks = true') ?? false,
        hookScript: fileExists(hookScriptPath()),
      },
      claude: {
        config: fileExists(claudeDesktopConfigPath()),
        hookScript: fileExists(hookScriptPath()),
      },
    }
  })

  ipcMain.handle('load-pets', () => {
    const builtinPath = getPetsJsonPath()
    let builtin: Array<{ id: string; displayName: string; folder: string; builtIn: boolean }> = []
    try {
      const raw = fs.readFileSync(builtinPath, 'utf-8')
      builtin = JSON.parse(raw).map((p: any) => ({
        id: String(p.id || ''),
        displayName: String(p.displayName || p.id || ''),
        folder: String(p.folder || p.id || ''),
        builtIn: true,
      }))
    } catch {}

    const customBase = path.resolve(hookScriptDeployPath(), 'custom')
    let custom: Array<{ id: string; displayName: string; folder: string; builtIn: boolean }> = []
    if (fs.existsSync(customBase)) {
      const entries = fs.readdirSync(customBase, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const safe = sanitizePetId(entry.name)
        if (!safe) continue
        const petJsonPath = safeJoin(customBase, safe, 'pet.json')
        if (!petJsonPath || !fs.existsSync(petJsonPath)) continue
        try {
          const petData = JSON.parse(fs.readFileSync(petJsonPath, 'utf-8'))
          custom.push({
            id: String(petData.id || safe),
            displayName: String(petData.displayName || safe),
            folder: safe,
            builtIn: false,
          })
        } catch {}
      }
    }

    return [...builtin, ...custom]
  })

  ipcMain.handle('add-custom-pet', (_event, petData: { id: string; displayName: string }) => {
    const safeId = sanitizePetId(petData.id)
    if (!safeId) return false
    const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
    if (!customDir) return false

    ensureDir(customDir)
    const petJson = {
      id: safeId,
      displayName: String(petData.displayName || safeId).slice(0, 64),
      description: 'Custom pet',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    writeFileEnsured(join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return true
  })

  ipcMain.handle('remove-custom-pet', (_event, petId: string) => {
    const safeId = sanitizePetId(petId)
    if (!safeId) return false
    const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
    if (!customDir) return false
    if (fs.existsSync(customDir)) {
      fs.rmSync(customDir, { recursive: true, force: true })
      return true
    }
    return false
  })

  ipcMain.handle('get-custom-pet-sprite', (_event, petId: string) => {
    const safeId = sanitizePetId(petId)
    if (!safeId) return null
    const spritePath = safeJoin(hookScriptDeployPath(), 'custom', safeId, 'spritesheet.webp')
    if (!spritePath) return null
    if (fs.existsSync(spritePath)) {
      return `file:///${spritePath.replace(/\\/g, '/')}`
    }
    return null
  })

  ipcMain.handle('import-pet-sprite', async (_event, petId: string, displayName: string) => {
    const safeId = sanitizePetId(petId)
    if (!safeId || !petWindow) return null
    const result = await dialog.showOpenDialog(petWindow, {
      title: 'Select spritesheet (192x208 per frame, .webp)',
      filters: [{ name: 'Images', extensions: ['webp', 'png', 'jpg'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const src = result.filePaths[0]
    const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
    if (!customDir) return null
    ensureDir(customDir)
    const dest = join(customDir, 'spritesheet.webp')
    fs.copyFileSync(src, dest)
    const petJson = {
      id: safeId,
      displayName: String(displayName || safeId).slice(0, 64),
      description: 'Custom pet',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    writeFileEnsured(join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return `file:///${dest.replace(/\\/g, '/')}`
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
