import { app, BrowserWindow, screen, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { request as httpRequest } from 'node:http'
import * as fs from 'fs'
import * as path from 'path'
import { unzipSync } from 'fflate'
import { createEventServer } from './event-server'
import {
  IS_MAC,
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
  claudeCodeSettingsPath,
  hookScriptPath,
  installIntegration,
  uninstallIntegration,
  repairWindowsInstalledHooks,
  readWindowState,
  writeWindowState,
  type IntegrationTarget,
} from './setup'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
let anchorBottomCenter: { x: number; y: number } | null = null
let resizeAnimHandle: ReturnType<typeof setInterval> | null = null
let dialogOpen = false
const pendingIntegrationTests = new Map<string, () => void>()

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (petWindow) {
      if (petWindow.isMinimized()) petWindow.restore()
      petWindow.show()
      petWindow.focus()
    }
  })
}

const PANEL_WIDTH = 320
const PANEL_GAP = 6
const INTEGRATION_TEST_SOURCES = [
  'opencode-cli',
  'opencode-desktop',
  'codex',
  'claude',
  'claude-desktop',
] as const

type IntegrationTestSource = typeof INTEGRATION_TEST_SOURCES[number]

function sendIntegrationTestEvent(
  source: IntegrationTestSource,
  sessionId: string,
  state: 'thinking' | 'offline',
): Promise<void> {
  const body = JSON.stringify({
    source,
    sessionId,
    project: 'Agent Pets Test',
    state,
    originalEvent: 'AgentPetsIntegrationTest',
    timestamp: Date.now(),
  })

  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: 17373,
      path: '/v1/events',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (response) => {
      response.resume()
      response.on('end', () => {
        if (response.statusCode === 204) {
          resolvePromise()
        } else {
          reject(new Error(`Event server returned ${response.statusCode ?? 'no status'}`))
        }
      })
    })

    request.setTimeout(1_500, () => {
      request.destroy(new Error('Event server timed out'))
    })
    request.on('error', reject)
    request.end(body)
  })
}

function waitForIntegrationTestReceipt(sessionId: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pendingIntegrationTests.delete(sessionId)
      reject(new Error('Live event was not received by this Agent Pets instance'))
    }, 1_500)

    pendingIntegrationTests.set(sessionId, () => {
      clearTimeout(timeout)
      pendingIntegrationTests.delete(sessionId)
      resolvePromise()
    })
  })
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Panel open/close animates its own content over 200ms (see StatusPanel.vue's
// .panel-enter-active transition). Without this, setBounds() would snap the
// native window to its new size instantly while the content fades in after —
// a visible, jarring mismatch. Tweening bounds keeps the two in sync.
function animateBounds(target: { x: number; y: number; width: number; height: number }, duration = 200) {
  if (!petWindow) return
  if (resizeAnimHandle) {
    clearInterval(resizeAnimHandle)
    resizeAnimHandle = null
  }

  const start = petWindow.getBounds()
  const startTime = Date.now()

  resizeAnimHandle = setInterval(() => {
    if (!petWindow) {
      if (resizeAnimHandle) clearInterval(resizeAnimHandle)
      resizeAnimHandle = null
      return
    }

    const t = Math.min(1, (Date.now() - startTime) / duration)
    const eased = easeOutCubic(t)

    petWindow.setBounds({
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased),
      width: Math.round(start.width + (target.width - start.width) * eased),
      height: Math.round(start.height + (target.height - start.height) * eased),
    })
    repositionVisiblePanel()

    if (t >= 1 && resizeAnimHandle) {
      clearInterval(resizeAnimHandle)
      resizeAnimHandle = null
    }
  }, 8)
}

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
  // Rough initial guess before the renderer's store hydrates and corrects it
  // via resizeWindow — keep these in sync with PET_BASE_W/H in agentStore.ts.
  const w = Math.round(250 * scale)
  const h = Math.round(232 * scale)

  // Restore wherever the user last dragged it to, rather than always
  // snapping back to the bottom-right default on every relaunch. Re-clamped
  // to the current work area in case it was saved on a monitor that's no
  // longer connected.
  const saved = readWindowState()
  const defaultX = screenWidth - w - 30
  const defaultY = screenHeight - h - 30
  const x = saved ? clamp(saved.x, 0, Math.max(0, screenWidth - w)) : defaultX
  const y = saved ? clamp(saved.y, 0, Math.max(0, screenHeight - h)) : defaultY

  petWindow = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
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

  // Without this, macOS ties the window to the Space it was created on —
  // alwaysOnTop alone does not make it follow you across a Space switch.
  // No Windows equivalent: virtual-desktop pinning there is a per-window
  // right-click toggle in Task View, not something Electron can set for us.
  if (IS_MAC) {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    petWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    petWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  petWindow.on('closed', () => {
    petWindow = null
    anchorBottomCenter = null
    if (resizeAnimHandle) {
      clearInterval(resizeAnimHandle)
      resizeAnimHandle = null
    }
    panelWindow?.close()
  })
}

// The panel is a separate always-on-top window rather than sharing the pet's
// window, so opening/closing or resizing it (Sessions <-> Settings) never
// moves or resizes the pet itself.
function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 380,
    show: false,
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

  if (IS_MAC) {
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    panelWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#panel`)
  } else {
    panelWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: 'panel' })
  }

  panelWindow.on('blur', () => {
    if (dialogOpen) return
    // Clicking the pet focuses petWindow just before the click handler's
    // 'panel-toggle' IPC arrives — if we hid on blur here too, the toggle
    // would then see the panel already hidden and reopen it (a flicker,
    // and clicking the pet could never close the panel). Let the toggle
    // handler own that case; blur-hide is only for genuine click-outside.
    if (petWindow?.isFocused()) return
    panelWindow?.hide()
  })

  panelWindow.on('closed', () => {
    panelWindow = null
  })
}

function computePanelBounds(height: number) {
  if (!petWindow) {
    const { workArea } = screen.getPrimaryDisplay()
    return { x: workArea.x, y: workArea.y, width: PANEL_WIDTH, height }
  }

  const petBounds = petWindow.getBounds()
  const { workArea } = screen.getDisplayMatching(petBounds)
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - PANEL_WIDTH)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
  let x = petBounds.x + Math.round(petBounds.width / 2) - Math.round(PANEL_WIDTH / 2)
  const aboveY = petBounds.y - height - PANEL_GAP
  const belowY = petBounds.y + petBounds.height + PANEL_GAP
  let y = aboveY

  // Keep the panel touching the pet even near a work-area edge. Prefer above,
  // but place it below when there is no room instead of clamping it far away.
  if (aboveY < workArea.y && belowY + height <= workArea.y + workArea.height) {
    y = belowY
  }

  x = clamp(x, workArea.x, maxX)
  y = clamp(y, workArea.y, maxY)

  return { x, y, width: PANEL_WIDTH, height }
}

function repositionVisiblePanel() {
  if (!panelWindow?.isVisible()) return
  const [, height] = panelWindow.getSize()
  panelWindow.setBounds(computePanelBounds(height))
}

function getPetsJsonPath(): string {
  if (app.isPackaged) {
    return join(app.getAppPath(), 'dist', 'pets', 'pets.json')
  }
  return join(__dirname, '..', 'dist', 'pets', 'pets.json')
}

function isCodexHooksEnabled(config: string | null): boolean {
  return !config?.includes('hooks = false') && !config?.includes('codex_hooks = false')
}

// Codex uses shell-form hooks (single "command" string containing the full
// invocation). Claude Code uses exec-form (command=node executable, args=[...])
// since Windows can't run .cmd/.bat files in exec form without a shell — so we
// check both `command` and `args` combined here.
function isAgentPetsHookConfigured(settingsPath: string, expectedArg: string): boolean {
  const raw = readFile(settingsPath)
  if (!raw) return false

  try {
    const config = JSON.parse(raw)
    const events = config?.hooks
    if (!events || typeof events !== 'object') return false

    const hookPaths = [
      hookScriptPath(),
      join(hookScriptDeployPath(), 'agent-hook.cmd'),
    ]
    return Object.values(events).some((groups: any) => {
      if (!Array.isArray(groups)) return false
      return groups.some((group) => {
        if (!Array.isArray(group?.hooks)) return false
        return group.hooks.some((hook: any) => {
          if (hook?.type !== 'command') return false
          const command = typeof hook.command === 'string' ? hook.command : ''
          const args = Array.isArray(hook.args) ? hook.args.join(' ') : ''
          const combined = `${command} ${args}`
          return hookPaths.some((hookPath) => combined.includes(hookPath)) && combined.includes(expectedArg)
        })
      })
    })
  } catch {
    return false
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return

  repairWindowsInstalledHooks()
  createPetWindow()
  createPanelWindow()

  createEventServer(
    () => [petWindow, panelWindow].filter((w): w is BrowserWindow => w !== null),
    (event) => {
      if (event.originalEvent === 'AgentPetsIntegrationTest') {
        pendingIntegrationTests.get(event.sessionId)?.()
      }
    },
  )

  ipcMain.on('pet-move', (_event, { dx, dy }) => {
    if (!petWindow) return
    const [x, y] = petWindow.getPosition()
    petWindow.setPosition(x + dx, y + dy)
    anchorBottomCenter = null
    panelWindow?.hide()
  })

  // Fired once when a drag ends (not per mousemove) so we're not hitting
  // disk on every pixel of movement.
  ipcMain.on('pet-drag-end', () => {
    if (!petWindow) return
    const [x, y] = petWindow.getPosition()
    writeWindowState(x, y)
  })

  ipcMain.on('pet-mouse-passthrough', (event, { ignore }) => {
    if (!petWindow || event.sender !== petWindow.webContents || typeof ignore !== 'boolean') return
    if (ignore) {
      // Forward mousemove events while click-through is active so the
      // renderer can make the visible pet interactive again on hover.
      petWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      petWindow.setIgnoreMouseEvents(false)
    }
  })

  ipcMain.on('panel-toggle', () => {
    if (!panelWindow) return
    if (panelWindow.isVisible()) {
      panelWindow.hide()
      return
    }
    panelWindow.setBounds(computePanelBounds(380))
    panelWindow.show()
    panelWindow.webContents.send('panel-opened')
  })

  ipcMain.on('panel-resize', (_event, { height }) => {
    if (!panelWindow) return
    panelWindow.setBounds(computePanelBounds(height))
  })

  ipcMain.on('panel-hide', () => {
    panelWindow?.hide()
  })

  ipcMain.on('pet-resize', (_event, { width, height }) => {
    if (!petWindow) return
    const { workArea } = screen.getDisplayMatching(petWindow.getBounds())

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

    const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
    newX = clamp(newX, workArea.x, maxX)
    newY = clamp(newY, workArea.y, maxY)

    animateBounds({ x: newX, y: newY, width, height })

    anchorBottomCenter = {
      x: newX + Math.round(width / 2),
      y: newY + height,
    }
  })

  ipcMain.on('pet-quit', () => {
    app.quit()
  })

  ipcMain.on('pet-restart', () => {
    app.relaunch()
    app.exit(0)
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
        enabled: isCodexHooksEnabled(codexConfig),
        configured: isAgentPetsHookConfigured(codexHooksPath(), ' codex'),
        hookScript: fileExists(hookScriptPath()),
      },
      claude: {
        config: fileExists(claudeDesktopConfigPath()),
        hookScript: fileExists(hookScriptPath()),
      },
      claudeCode: {
        settings: fileExists(claudeCodeSettingsPath()),
        configured: isAgentPetsHookConfigured(claudeCodeSettingsPath(), 'claude'),
        hookScript: fileExists(hookScriptPath()),
      },
    }
  })

  ipcMain.handle('test-integration', async (_event, source: IntegrationTestSource) => {
    if (!INTEGRATION_TEST_SOURCES.includes(source)) {
      return { ok: false, error: 'Unsupported integration source' }
    }

    const sessionId = `agent-pets-test-${source}-${Date.now()}`
    try {
      const receipt = waitForIntegrationTestReceipt(sessionId)
      await Promise.all([
        sendIntegrationTestEvent(source, sessionId, 'thinking'),
        receipt,
      ])
      setTimeout(() => {
        void sendIntegrationTestEvent(source, sessionId, 'offline').catch(() => {})
      }, 2_500)
      return { ok: true, verifiedAt: Date.now() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('install-integrations', (_event, target?: IntegrationTarget) => {
    try {
      installIntegration(target)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('uninstall-integrations', (_event, target?: IntegrationTarget) => {
    try {
      uninstallIntegration(target)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
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

  ipcMain.handle('rename-custom-pet', (_event, petId: string, newName: string) => {
    const safeId = sanitizePetId(petId)
    if (!safeId) return false
    if (typeof newName !== 'string' || newName.trim().length === 0) return false
    const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
    if (!customDir) return false
    const petJsonPath = safeJoin(customDir, 'pet.json')
    if (!petJsonPath || !fs.existsSync(petJsonPath)) return false
    try {
      const petData = JSON.parse(fs.readFileSync(petJsonPath, 'utf-8'))
      petData.displayName = newName.trim().slice(0, 64)
      writeFileEnsured(petJsonPath, JSON.stringify(petData, null, 2))
      return true
    } catch {
      return false
    }
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

  // Accepts sprite kits from community sites like codex-pets.net: a .zip
  // containing pet.json + a spritesheet image, laid out on the same
  // 192x208-per-frame grid our own built-in pets use (see PetAnimation.vue).
  ipcMain.handle('import-pet-zip', async () => {
    const owner = panelWindow ?? petWindow
    if (!owner) return { ok: false, error: 'No window available' }

    dialogOpen = true
    const result = await dialog.showOpenDialog(owner, {
      title: 'Select a sprite kit (.codex-pet.zip)',
      filters: [{ name: 'Pet sprite kit', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    dialogOpen = false
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'cancelled' }

    try {
      const zipBuf = fs.readFileSync(result.filePaths[0])
      const entries = unzipSync(new Uint8Array(zipBuf))

      const petJsonName = Object.keys(entries).find((name) => /(^|\/)pet\.json$/i.test(name))
      if (!petJsonName) return { ok: false, error: 'No pet.json found in this zip' }

      const petData = JSON.parse(Buffer.from(entries[petJsonName]).toString('utf-8'))
      const rawId = String(petData.id || petData.displayName || `imported-${Date.now()}`)
      const safeId = sanitizePetId(rawId) || sanitizePetId(`pet-${Date.now()}`)
      if (!safeId) return { ok: false, error: 'Could not derive a valid pet id' }

      const imageExt = /\.(webp|png|jpe?g)$/i
      const wantedBase = petData.spritesheetPath
        ? path.basename(String(petData.spritesheetPath)).toLowerCase()
        : null
      const spriteName =
        Object.keys(entries).find((name) => path.basename(name).toLowerCase() === wantedBase) ??
        Object.keys(entries).find((name) => imageExt.test(name))
      if (!spriteName) return { ok: false, error: 'No spritesheet image found in this zip' }

      const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
      if (!customDir) return { ok: false, error: 'Invalid destination path' }
      ensureDir(customDir)

      // Renderer sniffs the actual image bytes rather than trusting the
      // extension (see importPetSprite below), so normalizing to
      // spritesheet.webp here is safe even for a source .png/.jpg.
      fs.writeFileSync(join(customDir, 'spritesheet.webp'), Buffer.from(entries[spriteName]))

      const petJson = {
        id: safeId,
        displayName: String(petData.displayName || rawId).slice(0, 64),
        description: String(petData.description || 'Imported pet').slice(0, 500),
        spritesheetPath: 'spritesheet.webp',
        spriteVersionNumber: 2,
        kind: petData.kind === 'animal' ? 'animal' : 'person',
      }
      writeFileEnsured(join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))

      return { ok: true, id: safeId, displayName: petJson.displayName }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('import-pet-sprite', async (_event, petId: string, displayName: string) => {
    const safeId = sanitizePetId(petId)
    const owner = panelWindow ?? petWindow
    if (!safeId || !owner) return null
    dialogOpen = true
    const result = await dialog.showOpenDialog(owner, {
      title: 'Select spritesheet (192x208 per frame, .webp)',
      filters: [{ name: 'Images', extensions: ['webp', 'png', 'jpg'] }],
      properties: ['openFile'],
    })
    dialogOpen = false
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
      createPanelWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
