import { app, BrowserWindow, screen, ipcMain, dialog, session, protocol } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'path'
import { request as httpRequest } from 'node:http'
import * as fs from 'fs'
import * as path from 'path'
import { unzipSync } from 'fflate'
import { createEventServer } from './event-server'
import { getQuotaUsage } from './quota'
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
  refreshInstalledIntegrationScripts,
  readWindowState,
  writeWindowState,
  type IntegrationTarget,
} from './setup'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
let anchorBottomCenter: { x: number; y: number } | null = null
let resizeAnimHandle: ReturnType<typeof setInterval> | null = null
let dialogOpen = false
let eventToken = ''
const pendingIntegrationTests = new Map<string, () => void>()

// Enforce Chromium's renderer sandbox even if a future BrowserWindow option
// accidentally regresses. This must be called before app readiness.
app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'agent-pets',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

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
const MAX_PET_ZIP_BYTES = 10 * 1024 * 1024
const MAX_PET_ZIP_ENTRIES = 64
const MAX_PET_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
const MAX_PET_JSON_BYTES = 256 * 1024
const MAX_PET_IMAGE_BYTES = 20 * 1024 * 1024
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
        'x-agent-pets-token': eventToken,
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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const candidate = new URL(rawUrl)
    if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
      return candidate.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin
    }
    return candidate.protocol === 'agent-pets:'
      && candidate.hostname === 'app'
      && candidate.pathname === '/index.html'
  } catch {
    return false
  }
}

function secureRendererWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

function isTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  requiredWindow?: BrowserWindow | null,
): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererUrl(frame.url)) return false
  if (requiredWindow) return event.sender === requiredWindow.webContents
  return [petWindow, panelWindow].some((window) => window?.webContents === event.sender)
}

function assertTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  requiredWindow?: BrowserWindow | null,
): void {
  if (!isTrustedIpcSender(event, requiredWindow)) {
    throw new Error('Unauthorized IPC sender')
  }
}

function isIntegrationTarget(value: unknown): value is IntegrationTarget {
  return value === 'opencode' || value === 'codex' || value === 'claude' || value === 'claudeCode'
}

function sanitizePetId(id: string): string | null {
  if (typeof id !== 'string') return null
  const cleaned = id.replace(/[^a-zA-Z0-9_\-.]/g, '')
  if (cleaned.length === 0 || cleaned.length > 64) return null
  if (cleaned.includes('..')) return null
  return cleaned
}

function safeJoin(base: string, ...parts: string[]): string | null {
  const root = resolve(base)
  const resolvedPath = resolve(root, ...parts)
  const relative = path.relative(root, resolvedPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return resolvedPath
}

function isSupportedRasterImage(data: Uint8Array): boolean {
  const png = data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  const webp = data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP'
  return png || jpeg || webp
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function rasterContentType(data: Uint8Array): string | null {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

function readRegularFileWithin(root: string, relativePath: string, maxBytes: number): Buffer | null {
  const candidate = safeJoin(root, relativePath)
  if (!candidate) return null
  try {
    const rootReal = fs.realpathSync(root)
    const candidateStat = fs.lstatSync(candidate)
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size > maxBytes) return null
    const candidateReal = fs.realpathSync(candidate)
    const relative = path.relative(rootReal, candidateReal)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
    const data = fs.readFileSync(candidateReal)
    return data.length <= maxBytes ? data : null
  } catch {
    return null
  }
}

function configureSecureProtocol(): void {
  protocol.handle('agent-pets', (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    try {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      if (url.hostname === 'app') {
        const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
        const data = readRegularFileWithin(resolve(join(__dirname, '../dist')), relativePath, 25 * 1024 * 1024)
        if (!data) return new Response('Not found', { status: 404 })
        return new Response(Uint8Array.from(data), {
          status: 200,
          headers: {
            'content-type': contentTypeFor(relativePath),
            'x-content-type-options': 'nosniff',
          },
        })
      }
      if (url.hostname === 'custom') {
        const match = pathname.match(/^\/([a-zA-Z0-9_.-]{1,64})\/spritesheet\.webp$/)
        const safeId = match ? sanitizePetId(match[1]) : null
        if (!safeId) return new Response('Not found', { status: 404 })
        const customRoot = resolve(hookScriptDeployPath(), 'custom')
        const data = readRegularFileWithin(customRoot, join(safeId, 'spritesheet.webp'), MAX_PET_IMAGE_BYTES)
        const contentType = data ? rasterContentType(data) : null
        if (!data || !contentType) return new Response('Not found', { status: 404 })
        return new Response(Uint8Array.from(data), {
          status: 200,
          headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff' },
        })
      }
    } catch {}
    return new Response('Not found', { status: 404 })
  })
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
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  })

  secureRendererWindow(petWindow)

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
    petWindow.loadURL('agent-pets://app/index.html')
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
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  })

  secureRendererWindow(panelWindow)

  if (IS_MAC) {
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    panelWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#panel`)
  } else {
    panelWindow.loadURL('agent-pets://app/index.html#panel')
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

  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  eventToken = refreshInstalledIntegrationScripts()
  configureSecureProtocol()
  createPetWindow()
  createPanelWindow()

  createEventServer(
    () => [petWindow, panelWindow].filter((w): w is BrowserWindow => w !== null),
    eventToken,
    (event) => {
      if (event.originalEvent === 'AgentPetsIntegrationTest') {
        pendingIntegrationTests.get(event.sessionId)?.()
      }
    },
  )

  ipcMain.on('pet-move', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawDx = finiteNumber(data.dx)
    const rawDy = finiteNumber(data.dy)
    if (rawDx === null || rawDy === null) return
    const dx = clamp(rawDx, -2_000, 2_000)
    const dy = clamp(rawDy, -2_000, 2_000)
    const [x, y] = petWindow.getPosition()
    petWindow.setPosition(x + dx, y + dy)
    anchorBottomCenter = null
    panelWindow?.hide()
  })

  // Fired once when a drag ends (not per mousemove) so we're not hitting
  // disk on every pixel of movement.
  ipcMain.on('pet-drag-end', (event) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    const [x, y] = petWindow.getPosition()
    writeWindowState(x, y)
  })

  ipcMain.on('pet-mouse-passthrough', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const ignore = data.ignore
    if (typeof ignore !== 'boolean') return
    if (ignore) {
      // Forward mousemove events while click-through is active so the
      // renderer can make the visible pet interactive again on hover.
      petWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      petWindow.setIgnoreMouseEvents(false)
    }
  })

  ipcMain.on('panel-toggle', (event) => {
    if (!panelWindow || !isTrustedIpcSender(event, petWindow)) return
    if (panelWindow.isVisible()) {
      panelWindow.hide()
      return
    }
    panelWindow.setBounds(computePanelBounds(380))
    panelWindow.show()
    panelWindow.webContents.send('panel-opened')
  })

  ipcMain.on('panel-resize', (event, payload: unknown) => {
    if (!panelWindow || !isTrustedIpcSender(event, panelWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const height = finiteNumber(data.height)
    if (height === null) return
    panelWindow.setBounds(computePanelBounds(Math.round(clamp(height, 160, 900))))
  })

  ipcMain.on('panel-hide', (event) => {
    if (!isTrustedIpcSender(event, panelWindow)) return
    panelWindow?.hide()
  })

  ipcMain.on('pet-resize', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawWidth = finiteNumber(data.width)
    const rawHeight = finiteNumber(data.height)
    if (rawWidth === null || rawHeight === null) return
    const width = Math.round(clamp(rawWidth, 80, 1_600))
    const height = Math.round(clamp(rawHeight, 80, 1_600))
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

  ipcMain.on('pet-quit', (event) => {
    if (!isTrustedIpcSender(event)) return
    app.quit()
  })

  ipcMain.on('pet-restart', (event) => {
    if (!isTrustedIpcSender(event)) return
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('integration-status', (event) => {
    assertTrustedIpcSender(event, panelWindow)
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

  ipcMain.handle('quota-usage', async (event, force?: unknown) => {
    assertTrustedIpcSender(event)
    const usage = await getQuotaUsage(force === true)
    for (const win of [petWindow, panelWindow]) {
      if (win && !win.isDestroyed()) win.webContents.send('quota-usage-updated', usage)
    }
    return usage
  })

  ipcMain.handle('test-integration', async (event, source: IntegrationTestSource) => {
    assertTrustedIpcSender(event, panelWindow)
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

  ipcMain.handle('install-integrations', (event, target?: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (target !== undefined && !isIntegrationTarget(target)) {
      return { ok: false, error: 'Unsupported integration target' }
    }
    const safeTarget = target as IntegrationTarget | undefined
    try {
      installIntegration(safeTarget)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('uninstall-integrations', (event, target?: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (target !== undefined && !isIntegrationTarget(target)) {
      return { ok: false, error: 'Unsupported integration target' }
    }
    const safeTarget = target as IntegrationTarget | undefined
    try {
      uninstallIntegration(safeTarget)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('load-pets', (event) => {
    assertTrustedIpcSender(event)
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

  ipcMain.handle('add-custom-pet', (event, petData: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (!petData || typeof petData !== 'object') return false
    const data = petData as Record<string, unknown>
    const safeId = sanitizePetId(typeof data.id === 'string' ? data.id : '')
    if (!safeId) return false
    const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
    if (!customDir) return false

    ensureDir(customDir)
    const petJson = {
      id: safeId,
      displayName: String(data.displayName || safeId).slice(0, 64),
      description: 'Custom pet',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    writeFileEnsured(join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return true
  })

  ipcMain.handle('rename-custom-pet', (event, petId: string, newName: string) => {
    assertTrustedIpcSender(event, panelWindow)
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

  ipcMain.handle('remove-custom-pet', (event, petId: string) => {
    assertTrustedIpcSender(event, panelWindow)
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

  ipcMain.handle('get-custom-pet-sprite', (event, petId: string) => {
    assertTrustedIpcSender(event)
    const safeId = sanitizePetId(petId)
    if (!safeId) return null
    const spritePath = safeJoin(hookScriptDeployPath(), 'custom', safeId, 'spritesheet.webp')
    if (!spritePath) return null
    if (fs.existsSync(spritePath)) {
      return `agent-pets://custom/${encodeURIComponent(safeId)}/spritesheet.webp`
    }
    return null
  })

  // Accepts sprite kits from community sites like codex-pets.net: a .zip
  // containing pet.json + a spritesheet image, laid out on the same
  // 192x208-per-frame grid our own built-in pets use (see PetAnimation.vue).
  ipcMain.handle('import-pet-zip', async (event) => {
    assertTrustedIpcSender(event, panelWindow)
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
      const zipPath = result.filePaths[0]
      const zipStat = fs.statSync(zipPath)
      if (!zipStat.isFile() || zipStat.size > MAX_PET_ZIP_BYTES) {
        return { ok: false, error: 'Zip must be a regular file no larger than 10 MB' }
      }
      const zipBuf = fs.readFileSync(zipPath)
      if (zipBuf.length > MAX_PET_ZIP_BYTES) {
        return { ok: false, error: 'Zip must be no larger than 10 MB' }
      }

      let entryCount = 0
      let uncompressedBytes = 0
      const entries = unzipSync(new Uint8Array(zipBuf), {
        filter: (entry) => {
          entryCount += 1
          if (entryCount > MAX_PET_ZIP_ENTRIES) {
            throw new Error('Zip contains too many entries')
          }
          if (!Number.isFinite(entry.originalSize) || entry.originalSize < 0) {
            throw new Error('Zip contains an invalid entry size')
          }
          uncompressedBytes += entry.originalSize
          if (uncompressedBytes > MAX_PET_UNCOMPRESSED_BYTES) {
            throw new Error('Zip expands beyond the 25 MB safety limit')
          }
          const baseName = path.basename(entry.name)
          return /^pet\.json$/i.test(baseName) || /\.(webp|png|jpe?g)$/i.test(baseName)
        },
      })

      const petJsonName = Object.keys(entries).find((name) => /(^|\/)pet\.json$/i.test(name))
      if (!petJsonName) return { ok: false, error: 'No pet.json found in this zip' }
      if (entries[petJsonName].byteLength > MAX_PET_JSON_BYTES) {
        return { ok: false, error: 'pet.json exceeds the 256 KB safety limit' }
      }

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
      const spriteData = entries[spriteName]
      if (spriteData.byteLength > MAX_PET_IMAGE_BYTES) {
        return { ok: false, error: 'Spritesheet exceeds the 20 MB safety limit' }
      }
      if (!isSupportedRasterImage(spriteData)) {
        return { ok: false, error: 'Spritesheet content is not a valid PNG, JPEG, or WebP image' }
      }

      const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
      if (!customDir) return { ok: false, error: 'Invalid destination path' }
      ensureDir(customDir)

      // Renderer sniffs the actual image bytes rather than trusting the
      // extension (see importPetSprite below), so normalizing to
      // spritesheet.webp here is safe even for a source .png/.jpg.
      fs.writeFileSync(join(customDir, 'spritesheet.webp'), Buffer.from(spriteData))

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

  ipcMain.handle('import-pet-sprite', async (event, petId: string, displayName: string) => {
    assertTrustedIpcSender(event, panelWindow)
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
    const sourceStat = fs.statSync(src)
    if (!sourceStat.isFile() || sourceStat.size > MAX_PET_IMAGE_BYTES) return null
    const sourceData = fs.readFileSync(src)
    if (sourceData.length > MAX_PET_IMAGE_BYTES || !isSupportedRasterImage(sourceData)) return null
    const customDir = safeJoin(hookScriptDeployPath(), 'custom', safeId)
    if (!customDir) return null
    ensureDir(customDir)
    const dest = join(customDir, 'spritesheet.webp')
    fs.writeFileSync(dest, sourceData)
    const petJson = {
      id: safeId,
      displayName: String(displayName || safeId).slice(0, 64),
      description: 'Custom pet',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    writeFileEnsured(join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return `agent-pets://custom/${encodeURIComponent(safeId)}/spritesheet.webp`
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
