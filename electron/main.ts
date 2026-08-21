import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  dialog,
  session,
  protocol,
  globalShortcut,
  powerMonitor,
} from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'path'
import { request as httpRequest, type Server } from 'node:http'
import * as fs from 'fs'
import * as path from 'path'
import { unzipSync } from 'fflate'
import { createEventServer } from './event-server'
import { createAgentAdapterRegistry, isAgentAdapterId, type AgentAdapterRegistry } from './agent-adapter'
import { createAgentAdapterOperations } from './agent-adapter-operations'
import { getQuotaUsage } from './quota'
import { DesktopPreferencesStore, resolveLoginItemExecutable, writeJsonAtomic } from './desktop-preferences'
import { DesktopNotificationService } from './desktop-notifications'
import { DesktopTrayController } from './desktop-tray'
import { PermissionBroker } from './permission-broker'
import { appendPermissionAudit } from './permission-audit'
import { ProgressionStore } from './progression'
import { AchievementStore } from './achievements'
import { HistoryStore } from './history'
import { LocalUsageReader } from './local-usage'
import {
  createPresentationMcpServer,
  PRESENTATION_MCP_PORT,
} from './presentation-mcp'
import {
  normalizePresentationStatus,
  PresentationController,
} from './presentation-controller'
import { ProjectMcpRegistryStore } from './project-mcp-registry'
import { ProjectRoutingStore } from './project-routing'
import {
  createPermissionAdapterServer,
  PERMISSION_ADAPTER_PORT,
  PermissionAdapterRelay,
} from './permission-adapter-server'
import type { DesktopPreferences } from '../src/types/desktop'
import { setLocale, t } from '../src/i18n'
import type { ProgressionSnapshot } from '../src/types/progression'
import type { AchievementSnapshot, AchievementUnlock } from '../src/types/achievement'
import type { HistoryClearResult, HistoryCommandResult, HistorySummary } from '../src/types/history'
import type { PresentationIntent, PresentationStatusSnapshot } from '../src/types/presentation'
import type { ProjectMcpRegistrySnapshot, ProjectMcpRemovalSummary } from '../src/types/project-mcp'
import type { ProjectPetArchiveResult, ProjectPetCommandResult, ProjectPetView } from '../src/types/project-pet'
import type { PetEdge, PetWindowMode, PetWindowModeState } from '../src/types/pet-window'
import {
  EDGE_DWELL_MS,
  EDGE_TRIGGER_DISTANCE_PX,
  clampWindowBounds,
  edgeWindowBounds,
  miniWindowBounds,
  nearestEdge,
  type WindowBounds,
} from './pet-window-mode'
import {
  IS_MAC,
  hookScriptDeployPath,
  ensureDir,
  writeFileEnsured,
  installIntegration,
  uninstallIntegration,
  refreshInstalledIntegrationScripts,
  ensurePermissionToken,
  ensurePresentationToken,
  ensurePresentationMcpScript,
  presentationMcpScriptPath,
  resolveNodeBin,
  readWindowState,
  writeWindowState,
  type IntegrationTarget,
} from './setup'
import { installProjectMcp, removeProjectMcp } from './project-mcp-setup'
import { parsePetBehaviorManifest, type SanitizedPetBehaviorManifest } from './pet-behavior-manifest'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
let anchorBottomCenter: { x: number; y: number } | null = null
// Height in CSS px of the pet window's actually-painted content, reported by
// the pet renderer. The rest of the window is transparent tooltip headroom.
let petContentHeight: number | null = null
let resizeAnimHandle: ReturnType<typeof setInterval> | null = null
let dragPollHandle: ReturnType<typeof setInterval> | null = null
let shimejiPersistHandle: ReturnType<typeof setTimeout> | null = null
let dialogOpen = false
let eventToken = ''
let eventServer: Server | null = null
let agentAdapterRegistry: AgentAdapterRegistry | null = null
let permissionAdapterServer: Server | null = null
let permissionBroker: PermissionBroker | null = null
let permissionRelay: PermissionAdapterRelay | null = null
let progressionStore: ProgressionStore | null = null
let achievementStore: AchievementStore | null = null
let achievementStoreRetryTimer: ReturnType<typeof setTimeout> | null = null
let achievementStoreRetryAttempt = 0
let historyStore: HistoryStore | null = null
let localUsageReader: LocalUsageReader | null = null
let localUsageScanTimer: ReturnType<typeof setInterval> | null = null
let localUsageScanPromise: Promise<void> | null = null
let presentationController: PresentationController | null = null
let presentationMcpServer: Server | null = null
let projectMcpRegistry: ProjectMcpRegistryStore | null = null
let projectRoutingStore: ProjectRoutingStore | null = null
let presentationStatusProjection: PresentationStatusSnapshot = {
  activePets: [],
  dnd: false,
  enabled: true,
}
let desktopPreferences: DesktopPreferencesStore | null = null
let desktopNotifications: DesktopNotificationService | null = null
let desktopTray: DesktopTrayController | null = null
let petWindowMode: PetWindowMode = 'normal'
let petWindowEdge: PetEdge | null = null
let normalPetBounds: WindowBounds | null = null
// Full-size bounds captured immediately before entering Edge. The native
// window is replaced by a small edge handle, so hover/click must restore this
// exact snapshot instead of deriving a new position from the handle bounds.
let edgeRestoreBounds: WindowBounds | null = null
let edgeDwellHandle: ReturnType<typeof setTimeout> | null = null
let edgeDwellCandidate: { displayId: number; edge: PetEdge } | null = null
let isQuitting = false
let notificationAttentionCount = 0
let permissionAttentionCount = 0
const pendingIntegrationTests = new Map<string, () => void>()
const PERMISSION_ALLOW_HOTKEY = 'CommandOrControl+Shift+Y'
const PERMISSION_DENY_HOTKEY = 'CommandOrControl+Shift+N'

// Enforce Chromium's renderer sandbox even if a future BrowserWindow option
// accidentally regresses. This must be called before app readiness.
app.enableSandbox()
// Phase 3 uses Node's built-in SQLite driver. Electron exposes it behind the
// same experimental switch as the bundled Node runtime; keeping the switch in
// the main process avoids renderer access to the database or its handles.
app.commandLine.appendSwitch('experimental-sqlite')
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
    showPetWindow()
  })
}

const PANEL_WIDTH = 460
const PANEL_MIN_WIDTH = 340
const PANEL_MAX_WIDTH = 760
const PANEL_GAP = 6
// petWindow's actual bounds include a fixed, unscaled band of transparent
// space reserved above the visible sprite for the quota tooltip to pop
// into (see QUOTA_TOOLTIP_HEADROOM_H in agentStore.ts — keep in sync).
// computePanelBounds must anchor off the visible pet, not the raw window
// bounds, or the panel opens with a big gap floating above the pet — worst
// at small pet sizes, where that fixed band is a large fraction of the
// window's total (scaled) height. Only a fallback now: the renderer reports
// its measured content height (see petContentHeight), which also accounts
// for the status lines, whose size does not scale with the pet.
const PET_WINDOW_TOP_HEADROOM = 190
const MAX_PET_ZIP_BYTES = 10 * 1024 * 1024
const MAX_PET_ZIP_ENTRIES = 64
const MAX_PET_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
const MAX_PET_JSON_BYTES = 256 * 1024
const MAX_PET_IMAGE_BYTES = 20 * 1024 * 1024
const INTEGRATION_TEST_SOURCES = [
  'opencode-cli',
  'opencode-desktop',
  'codex',
  'codex-desktop',
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

function clearEdgeDwell(): void {
  if (edgeDwellHandle) clearTimeout(edgeDwellHandle)
  edgeDwellHandle = null
  edgeDwellCandidate = null
}

function petModeState(): PetWindowModeState {
  return petWindowEdge
    ? { mode: petWindowMode, edge: petWindowEdge }
    : { mode: petWindowMode }
}

function broadcastPetWindowMode(): void {
  const state = petModeState()
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('pet-window-mode-updated', state)
    }
  }
}

function displayForBounds(bounds: WindowBounds) {
  return screen.getDisplayMatching({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  })
}

function displayForSavedState(saved: ReturnType<typeof readWindowState>) {
  if (saved?.displayId !== undefined) {
    const byId = screen.getAllDisplays().find(display => display.id === saved.displayId)
    if (byId) return byId
  }
  const savedBounds = saved?.normalBounds ?? (
    saved && saved.width !== undefined && saved.height !== undefined
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : null
  )
  return savedBounds ? displayForBounds(savedBounds) : screen.getPrimaryDisplay()
}

function persistCurrentPetWindowState(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const bounds = petWindow.getBounds()
  const display = displayForBounds(bounds)
  const normal = edgeRestoreBounds ?? normalPetBounds ?? bounds
  writeWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    mode: petWindowMode,
    edge: petWindowEdge ?? undefined,
    displayId: display.id,
    displayBounds: display.bounds,
    normalBounds: normal,
  })
}

function scheduleShimejiPositionPersist(): void {
  if (shimejiPersistHandle) clearTimeout(shimejiPersistHandle)
  shimejiPersistHandle = setTimeout(() => {
    shimejiPersistHandle = null
    persistCurrentPetWindowState()
  }, 2_000)
}

function applyNormalPetBounds(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  clearEdgeDwell()
  const current = petWindow.getBounds()
  const restore = edgeRestoreBounds ?? normalPetBounds ?? current
  const display = displayForBounds(restore)
  const normal = clampWindowBounds(restore, display.workArea)
  normalPetBounds = normal
  edgeRestoreBounds = null
  petWindowMode = 'normal'
  petWindowEdge = null
  petWindow.setIgnoreMouseEvents(false)
  petWindow.setBounds(normal)
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
  desktopTray?.rebuild()
}

function applyMiniPetBounds(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  clearEdgeDwell()
  const current = petWindow.getBounds()
  const normalSource = edgeRestoreBounds ?? normalPetBounds ?? current
  const display = displayForBounds(normalSource)
  normalPetBounds = clampWindowBounds(normalSource, display.workArea)
  edgeRestoreBounds = null
  petWindowMode = 'mini'
  petWindowEdge = null
  petWindow.setIgnoreMouseEvents(false)
  petWindow.setBounds(miniWindowBounds(normalPetBounds, display.workArea))
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
  desktopTray?.rebuild()
}

function applyEdgePetBounds(edge: PetEdge): void {
  if (!petWindow || petWindow.isDestroyed()) return
  if (!currentDesktopPreferences().edgeModeEnabled) {
    applyNormalPetBounds()
    return
  }
  clearEdgeDwell()
  const current = petWindow.getBounds()
  // Edge can only be entered from a full-size normal window. Capture the
  // actual bounds at this moment so expansion returns to the user's exact
  // pre-edge position, even if a previous persisted snapshot is stale.
  const normalSource = petWindowMode === 'normal'
    ? current
    : edgeRestoreBounds ?? normalPetBounds ?? current
  const display = displayForBounds(normalSource)
  normalPetBounds = clampWindowBounds(normalSource, display.workArea)
  edgeRestoreBounds = { ...normalPetBounds }
  petWindowMode = 'edge'
  petWindowEdge = edge
  // Edge is an explicit, opaque handle-sized window. Keep it interactive so
  // a click or drag can expand it; click-through remains owned by Normal's
  // transparent-region hit testing.
  petWindow.setIgnoreMouseEvents(false)
  petWindow.setBounds(edgeWindowBounds(normalPetBounds, display.workArea, edge))
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
  desktopTray?.rebuild()
}

function setPetWindowMode(mode: PetWindowMode): void {
  if (!petWindow || petWindow.isDestroyed()) return
  // A permission bubble must remain fully usable. The Broker remains the
  // authority, so a compact/partially hidden window is never allowed while a
  // request is pending.
  if (mode !== 'normal' && (permissionBroker?.listRequests().length ?? 0) > 0) {
    applyNormalPetBounds()
    return
  }
  if (mode === 'normal') applyNormalPetBounds()
  else if (mode === 'mini') applyMiniPetBounds()
  else if (petWindowEdge) applyEdgePetBounds(petWindowEdge)
}

function toggleMiniMode(): void {
  setPetWindowMode(petWindowMode === 'mini' ? 'normal' : 'mini')
}

function scheduleEdgeDwell(): void {
  clearEdgeDwell()
  if (
    !petWindow
    || petWindow.isDestroyed()
    || petWindowMode !== 'normal'
    || !currentDesktopPreferences().edgeModeEnabled
  ) return
  const bounds = petWindow.getBounds()
  const display = displayForBounds(bounds)
  const edge = nearestEdge(bounds, display.workArea, EDGE_TRIGGER_DISTANCE_PX)
  if (!edge) return
  edgeDwellCandidate = { displayId: display.id, edge }
  edgeDwellHandle = setTimeout(() => {
    edgeDwellHandle = null
    const candidate = edgeDwellCandidate
    edgeDwellCandidate = null
    if (!candidate || !petWindow || petWindow.isDestroyed()) return
    const current = petWindow.getBounds()
    const currentDisplay = displayForBounds(current)
    const currentEdge = nearestEdge(current, currentDisplay.workArea, EDGE_TRIGGER_DISTANCE_PX)
    if (currentDisplay.id === candidate.displayId && currentEdge === candidate.edge) {
      applyEdgePetBounds(candidate.edge)
    }
  }, EDGE_DWELL_MS)
}

function rehomePetWindowForDisplayChange(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const current = petWindow.getBounds()
  const display = displayForBounds(current)
  const normalSource = edgeRestoreBounds ?? normalPetBounds ?? current
  normalPetBounds = clampWindowBounds(normalSource, display.workArea)
  if (petWindowMode === 'edge') edgeRestoreBounds = { ...normalPetBounds }
  if (petWindowMode === 'mini') {
    petWindow.setBounds(miniWindowBounds(normalPetBounds, display.workArea))
  } else if (petWindowMode === 'edge' && petWindowEdge) {
    petWindow.setBounds(edgeWindowBounds(normalPetBounds, display.workArea, petWindowEdge))
  } else {
    petWindowMode = 'normal'
    petWindowEdge = null
    petWindow.setIgnoreMouseEvents(false)
    petWindow.setBounds(normalPetBounds)
  }
  repositionVisiblePanel()
  persistCurrentPetWindowState()
  broadcastPetWindowMode()
}

function createPetWindow() {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const rawScale = parseFloat(process.env.PET_SCALE || '1')
  const scale = clamp(isNaN(rawScale) ? 1 : rawScale, 0.3, 5)

  // Restore wherever the user last dragged it to, rather than always
  // snapping back to the bottom-right default on every relaunch. Re-clamped
  // to the current work area in case it was saved on a monitor that's no
  // longer connected.
  const saved = readWindowState()

  // The pet size lives in the renderer's localStorage, which the main process
  // can't read, so the last size the renderer asked for is persisted with the
  // position and reused here. Without it the window would always be born at
  // the 1x (L) size and only shrink once the store hydrates — long enough for
  // the panel to open against L-sized bounds, and, because the window is
  // bottom-anchored, enough to walk the pet down the screen every launch.
  // The fallback is a rough guess; keep it in sync with PET_BASE_W/H,
  // QUOTA_TOOLTIP_MIN_W and QUOTA_TOOLTIP_HEADROOM_H in agentStore.ts.
  const w = saved?.width !== undefined
    ? Math.round(clamp(saved.width, 80, 1_600))
    : Math.max(Math.round(250 * scale), 260)
  const h = saved?.height !== undefined
    ? Math.round(clamp(saved.height, 80, 1_600))
    : Math.round(232 * scale) + 190

  const savedDisplay = displayForSavedState(saved)
  const savedNormal = saved?.normalBounds ?? (
    saved
      ? { x: saved.x, y: saved.y, width: saved.width ?? w, height: saved.height ?? h }
      : {
          x: primaryWorkArea.x + primaryWorkArea.width - w - 30,
          y: primaryWorkArea.y + primaryWorkArea.height - h - 30,
          width: w,
          height: h,
        }
  )
  normalPetBounds = clampWindowBounds(savedNormal, savedDisplay.workArea)
  const edgeModeEnabled = currentDesktopPreferences().edgeModeEnabled
  const attachedEdge = nearestEdge(normalPetBounds, savedDisplay.workArea, EDGE_TRIGGER_DISTANCE_PX)
  const canRestoreEdge = saved?.mode === 'edge'
    && edgeModeEnabled
    && attachedEdge !== null
    && (saved.edge === undefined || saved.edge === attachedEdge)
  petWindowMode = saved?.mode === 'mini' ? 'mini' : canRestoreEdge ? 'edge' : 'normal'
  petWindowEdge = canRestoreEdge ? (saved.edge ?? attachedEdge) : null
  edgeRestoreBounds = canRestoreEdge ? { ...normalPetBounds } : null
  const initialBounds = petWindowMode === 'mini'
    ? miniWindowBounds(normalPetBounds, savedDisplay.workArea)
    : petWindowMode === 'edge' && petWindowEdge
      ? edgeWindowBounds(normalPetBounds, savedDisplay.workArea, petWindowEdge)
      : normalPetBounds

  petWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Windows only: a frameless window still gets the WS_THICKFRAME resize
    // border by default, which makes DWM apply its normal non-client move
    // animation the instant the window is grabbed — visible as the whole
    // pet sliding down a few pixels before drag tracking kicks in. Disabling
    // it removes that OS-level animation so drag tracks the cursor exactly.
    thickFrame: false,
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

  petWindow.webContents.once('did-finish-load', () => {
    broadcastPetWindowMode()
  })

  petWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hidePetWindow()
  })
  petWindow.on('show', () => {
    desktopTray?.rebuild()
    schedulePermissionUiSync()
  })
  petWindow.on('hide', () => {
    desktopTray?.rebuild()
    schedulePermissionUiSync()
  })

  petWindow.on('closed', () => {
    petWindow = null
    anchorBottomCenter = null
    normalPetBounds = null
    edgeRestoreBounds = null
    petWindowEdge = null
    clearEdgeDwell()
    if (shimejiPersistHandle) {
      clearTimeout(shimejiPersistHandle)
      shimejiPersistHandle = null
    }
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
    height: 560,
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

function computePanelBounds(height: number, width = PANEL_WIDTH) {
  const panelWidth = Math.round(clamp(width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH))
  if (!petWindow) {
    const { workArea } = screen.getPrimaryDisplay()
    return { x: workArea.x, y: workArea.y, width: panelWidth, height }
  }

  const petBounds = petWindow.getBounds()
  // The window's horizontal center still matches the visible sprite's (the
  // headroom band is only added above, not to the sides), so x needs no
  // adjustment — only the vertical anchor does.
  //
  // Prefer the height the pet renderer measured for its own content: the
  // sprite is bottom-anchored in the window, and how much of the window it
  // actually fills depends on pet size AND status-line count, neither of
  // which the constant below can express. It is only the fallback for the
  // brief window before the first measurement arrives.
  const visibleHeight = petContentHeight !== null
    ? clamp(petContentHeight, 40, petBounds.height)
    : petBounds.height - PET_WINDOW_TOP_HEADROOM
  const visibleTop = petBounds.y + petBounds.height - visibleHeight
  const { workArea } = screen.getDisplayMatching(petBounds)
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - panelWidth)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
  let x = petBounds.x + Math.round(petBounds.width / 2) - Math.round(panelWidth / 2)
  const aboveY = visibleTop - height - PANEL_GAP
  const belowY = visibleTop + visibleHeight + PANEL_GAP
  let y = aboveY

  // Keep the panel touching the pet even near a work-area edge. Prefer above,
  // but place it below when there is no room instead of clamping it far away.
  if (aboveY < workArea.y && belowY + height <= workArea.y + workArea.height) {
    y = belowY
  }

  x = clamp(x, workArea.x, maxX)
  y = clamp(y, workArea.y, maxY)

  return { x, y, width: panelWidth, height }
}

// Status-line count can flap as agents come and go, so coalesce the writes
// instead of hitting disk on every resize.
let persistBoundsHandle: ReturnType<typeof setTimeout> | null = null

function persistPetBounds(x: number, y: number, width: number, height: number) {
  if (persistBoundsHandle) clearTimeout(persistBoundsHandle)
  persistBoundsHandle = setTimeout(() => {
    persistBoundsHandle = null
    const current = { x, y, width, height }
    if (petWindowMode === 'normal') normalPetBounds = current
    persistCurrentPetWindowState()
  }, 1_000)
}

function repositionVisiblePanel() {
  if (!panelWindow?.isVisible()) return
  const [width, height] = panelWindow.getSize()
  panelWindow.setBounds(computePanelBounds(height, width))
}

function ensureDesktopWindows(): boolean {
  if (!app.isReady()) return false
  if (!petWindow || petWindow.isDestroyed()) createPetWindow()
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow()
  return Boolean(petWindow && panelWindow)
}

function showPetWindow(): void {
  if (!ensureDesktopWindows() || !petWindow) return
  if (petWindow.isMinimized()) petWindow.restore()
  petWindow.show()
  petWindow.focus()
  desktopTray?.rebuild()
}

function hidePetWindow(): void {
  panelWindow?.hide()
  petWindow?.hide()
  desktopTray?.rebuild()
}

function showPanelWindow(view: 'sessions' | 'settings' = 'sessions'): void {
  if (!ensureDesktopWindows() || !panelWindow) return
  if (petWindowMode === 'edge') applyNormalPetBounds()
  showPetWindow()
  panelWindow.setBounds(computePanelBounds(view === 'settings' ? 720 : 560))
  panelWindow.show()
  panelWindow.focus()
  desktopNotifications?.clearAttention()

  const notifyRenderer = () => {
    if (!panelWindow || panelWindow.isDestroyed()) return
    panelWindow.webContents.send('panel-opened')
    if (view === 'settings') panelWindow.webContents.send('panel-open-settings')
  }
  if (panelWindow.webContents.isLoading()) {
    panelWindow.webContents.once('did-finish-load', notifyRenderer)
  } else {
    notifyRenderer()
  }
}

function currentDesktopPreferences(): DesktopPreferences {
  if (!desktopPreferences) {
    return {
      dndEnabled: false,
      notificationsEnabled: true,
      permissionBubbleEnabled: true,
      presentationMcpEnabled: true,
      achievementsEnabled: true,
      edgeModeEnabled: false,
      shimejiEnabled: false,
      soundEnabled: false,
      launchAtStartup: false,
      launchAtStartupSupported: false,
      locale: 'zh-TW',
    }
  }
  return desktopPreferences.get()
}

function broadcastDesktopPreferences(preferences: DesktopPreferences): void {
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop-preferences-updated', preferences)
    }
  }
}

function currentPowerSaveState(): boolean {
  try {
    return powerMonitor.isOnBatteryPower()
  } catch {
    return false
  }
}

function broadcastPowerSaveState(): void {
  const powerSave = currentPowerSaveState()
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('power-save-state-updated', powerSave)
    }
  }
}

function updateDesktopPreferences(patch: unknown): DesktopPreferences {
  if (!desktopPreferences) throw new Error('Desktop preferences are not ready')
  const preferences = desktopPreferences.update(patch)
  setLocale(preferences.locale)
  if (!preferences.edgeModeEnabled && petWindowMode === 'edge') applyNormalPetBounds()
  if (!preferences.presentationMcpEnabled || preferences.dndEnabled) {
    presentationController?.clear()
  }
  desktopTray?.rebuild()
  broadcastDesktopPreferences(preferences)
  schedulePermissionUiSync()
  return preferences
}

function unregisterPermissionHotkeys(): void {
  if (!app.isReady()) return
  for (const accelerator of [PERMISSION_ALLOW_HOTKEY, PERMISSION_DENY_HOTKEY]) {
    if (globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator)
  }
}

function syncTrayAttention(): void {
  desktopTray?.setAttentionCount(notificationAttentionCount + permissionAttentionCount)
}

function broadcastPermissionRequests(): void {
  const requests = permissionBroker?.listRequests() ?? []
  if (requests.length > 0 && petWindowMode !== 'normal') {
    applyNormalPetBounds()
  }
  permissionAttentionCount = requests.length
  syncTrayAttention()
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('permission-requests-updated', requests)
    }
  }

  unregisterPermissionHotkeys()
  const top = requests[0]
  const permissionBubbleEnabled = currentDesktopPreferences().permissionBubbleEnabled
  if (
    !permissionBubbleEnabled
    || !top
    || top.status !== 'pending'
    || !top.hotkeyEligible
    || !petWindow
    || petWindow.isDestroyed()
    || !petWindow.isVisible()
  ) return

  try {
    if (top.allowedDecisions.includes('allow_once')) {
      globalShortcut.register(PERMISSION_ALLOW_HOTKEY, () => {
        void permissionBroker?.decide(top.requestId, 'allow_once', 'hotkey')
      })
    }
    if (top.allowedDecisions.includes('deny')) {
      globalShortcut.register(PERMISSION_DENY_HOTKEY, () => {
        void permissionBroker?.decide(top.requestId, 'deny', 'hotkey')
      })
    }
  } catch {
    unregisterPermissionHotkeys()
  }
}

function broadcastProgression(snapshot?: ProgressionSnapshot): void {
  const next = snapshot ?? progressionStore?.getSnapshot()
  if (!next) return
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('progression-updated', next)
    }
  }
}

function broadcastAchievements(petId?: string): void {
  const snapshot = achievementStore?.getSnapshot(
    petId ?? progressionStore?.getActivePetId() ?? 'aang-airbender',
  )
  if (!snapshot) return
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('achievements-updated', snapshot)
  }
}

function broadcastAchievementUnlock(unlock: AchievementUnlock): void {
  desktopNotifications?.showAchievement(unlock)
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('achievement-unlocked', unlock)
  }
  // The unlock payload identifies the routed pet for the visual reward, but
  // the gallery in each renderer must remain scoped to its currently selected
  // pet rather than jumping to a background project pet.
  broadcastAchievements()
}

function currentHistorySummary(projectId?: string): HistorySummary | null {
  if (!historyStore) return null
  return historyStore.getSummary(progressionStore?.getActivePetId() ?? 'aang-airbender', projectId)
}

async function refreshLocalUsage(): Promise<void> {
  if (!localUsageReader || localUsageScanPromise) return localUsageScanPromise ?? Promise.resolve()
  localUsageScanPromise = localUsageReader.scan()
    .then(result => {
      if (result.recordsImported > 0) broadcastHistoryUpdated()
    })
    .catch(error => {
      console.error('Local token usage scan failed', error)
    })
    .finally(() => {
      localUsageScanPromise = null
    })
  return localUsageScanPromise
}

function broadcastHistoryUpdated(): void {
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('history-updated')
  }
}

function broadcastPresentationIntent(intent: PresentationIntent): void {
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('presentation-intent', intent)
    }
  }
}

function createPresentationServices(presentationToken: string): void {
  if (presentationController || presentationMcpServer) return

  presentationController = new PresentationController({
    emit: broadcastPresentationIntent,
    getStatus: () => {
      const preferences = currentDesktopPreferences()
      return normalizePresentationStatus({
        ...presentationStatusProjection,
        dnd: preferences.dndEnabled,
        enabled: preferences.presentationMcpEnabled,
      })
    },
    getBlockReason: () => {
      const preferences = currentDesktopPreferences()
      if (!preferences.presentationMcpEnabled) return 'disabled'
      if (preferences.dndEnabled) return 'dnd_enabled'
      return null
    },
  })

  const server = createPresentationMcpServer({
    token: presentationToken,
    controller: presentationController,
  })
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Presentation MCP port ${PRESENTATION_MCP_PORT} is already in use.`)
      return
    }
    console.error('Presentation MCP server error:', error)
  })
  server.listen(PRESENTATION_MCP_PORT, '127.0.0.1', () => {
    if (!app.isPackaged) {
      console.log(`Presentation MCP control listening on http://127.0.0.1:${PRESENTATION_MCP_PORT}`)
    }
  })
  presentationMcpServer = server
}

function createProgressionServices(): void {
  if (progressionStore) return
  try {
    progressionStore = new ProgressionStore(join(app.getPath('userData'), 'progression.sqlite'))
  } catch (error) {
    // A missing SQLite runtime must not prevent the desktop pet from starting;
    // the renderer simply keeps its progression card unavailable until the
    // runtime is repaired. No in-memory fallback is presented as durable XP.
    console.error('Progression storage is unavailable', error)
    progressionStore = null
  }
}

// Init can fail transiently (e.g. antivirus/cloud-sync briefly holding the
// file at startup); retry a few times with backoff instead of disabling
// achievements silently for the rest of the session.
const ACHIEVEMENT_STORE_RETRY_DELAYS_MS = [3_000, 10_000, 30_000]

function createAchievementServices(): void {
  if (achievementStore) return
  try {
    achievementStore = new AchievementStore(join(app.getPath('userData'), 'achievements.sqlite'))
    achievementStoreRetryAttempt = 0
    if (achievementStoreRetryTimer) {
      clearTimeout(achievementStoreRetryTimer)
      achievementStoreRetryTimer = null
    }
    // A retry can succeed after the renderer's initial achievements-init call
    // already came back null; push the real snapshot now so the gallery
    // recovers without requiring a manual reload.
    broadcastAchievements()
  } catch (error) {
    // Achievements are an additive feedback surface. A broken achievement
    // database must never prevent XP, permissions, history, or event ingest.
    console.error('Achievement storage is unavailable', error)
    logAchievementDiagnostic('init', error)
    achievementStore = null
    scheduleAchievementStoreRetry()
  }
}

function logAchievementDiagnostic(label: string, error: unknown, extra?: unknown): void {
  try {
    fs.appendFileSync(
      join(app.getPath('userData'), 'achievements-init-error.log'),
      `${new Date().toISOString()} [${label}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        + `${extra !== undefined ? ` extra=${JSON.stringify(extra)}` : ''}\n`,
    )
  } catch {}
}

function scheduleAchievementStoreRetry(): void {
  if (achievementStoreRetryTimer) return
  const delay = ACHIEVEMENT_STORE_RETRY_DELAYS_MS[achievementStoreRetryAttempt]
  if (delay === undefined) return
  achievementStoreRetryAttempt += 1
  achievementStoreRetryTimer = setTimeout(() => {
    achievementStoreRetryTimer = null
    createAchievementServices()
  }, delay)
}

function createHistoryServices(): void {
  if (historyStore) return
  try {
    historyStore = new HistoryStore(join(app.getPath('userData'), 'history.sqlite'))
    localUsageReader = new LocalUsageReader({
      homeDir: app.getPath('home'),
      history: historyStore,
      projectRouting: projectRoutingStore,
    })
    localUsageScanTimer = setInterval(() => {
      void refreshLocalUsage()
    }, 60_000)
    void refreshLocalUsage()
  } catch (error) {
    // History is an additive HUD feature. A broken history database must not
    // prevent the pet, event receiver, XP, or permission controls from booting.
    console.error('History storage is unavailable', error)
    historyStore = null
    localUsageReader = null
  }
}

function isProgressionPetId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value)
}

function setActiveProgressionPet(petId: string): ProgressionSnapshot | null {
  if (!progressionStore) return null
  const snapshot = progressionStore.setActivePet(petId)
  broadcastProgression(snapshot)
  broadcastAchievements(petId)
  return snapshot
}

function schedulePermissionUiSync(): void {
  queueMicrotask(() => broadcastPermissionRequests())
}

function cancelPermissionRequests(
  reason: 'system_lock' | 'system_suspend' | 'broker_shutdown',
): void {
  const broker = permissionBroker
  if (!broker) return
  for (const request of broker.listRequests()) {
    broker.resolveExternally(request.requestId, reason)
  }
}

function createPermissionServices(permissionToken: string): void {
  if (permissionBroker || permissionRelay || permissionAdapterServer) return

  const relay = new PermissionAdapterRelay()
  const broker = new PermissionBroker({
    onChanged: schedulePermissionUiSync,
    onAudit: record => {
      try {
        appendPermissionAudit(join(app.getPath('userData'), 'permission-audit.json'), record)
      } catch (error) {
        console.error('Failed to persist permission audit record', error)
      }
    },
  })
  broker.registerAdapter(relay.createPort('opencode-cli'))
  broker.registerAdapter(relay.createPort('opencode-desktop'))
  const server = createPermissionAdapterServer({ token: permissionToken, broker, relay })
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Permission adapter port ${PERMISSION_ADAPTER_PORT} is already in use.`)
      return
    }
    console.error('Permission adapter server error:', error)
  })
  server.listen(PERMISSION_ADAPTER_PORT, '127.0.0.1', () => {
    if (!app.isPackaged) {
      console.log(`Permission adapter listening on http://127.0.0.1:${PERMISSION_ADAPTER_PORT}`)
    }
  })

  permissionRelay = relay
  permissionBroker = broker
  permissionAdapterServer = server
  powerMonitor.on('lock-screen', () => cancelPermissionRequests('system_lock'))
  powerMonitor.on('suspend', () => cancelPermissionRequests('system_suspend'))
}

function createDesktopServices(): void {
  if (desktopPreferences || desktopTray || desktopNotifications) return

  // electron-builder's Windows portable target runs the app from a temporary
  // extraction directory. Register the original launcher path, never that
  // ephemeral process.execPath. Unsupported/invalid paths fail closed.
  const loginItemExecutable = resolveLoginItemExecutable(
    process.platform,
    app.isPackaged,
    process.execPath,
    process.env.PORTABLE_EXECUTABLE_FILE,
  )

  desktopPreferences = new DesktopPreferencesStore(
    join(app.getPath('userData'), 'desktop-preferences.json'),
    {
      supported: loginItemExecutable !== null,
      getOpenAtLogin: () => {
        if (!loginItemExecutable) return false
        return app.getLoginItemSettings({ path: loginItemExecutable }).openAtLogin
      },
      setOpenAtLogin: (enabled) => {
        if (!loginItemExecutable) return false
        app.setLoginItemSettings({ openAtLogin: enabled, path: loginItemExecutable })
        return app.getLoginItemSettings({ path: loginItemExecutable }).openAtLogin
      },
    },
  )
  setLocale(currentDesktopPreferences().locale)

  desktopNotifications = new DesktopNotificationService({
    logFilePath: join(app.getPath('userData'), 'notification-log.json'),
    getPreferences: currentDesktopPreferences,
    isAppFocused: () => [petWindow, panelWindow].some(window => window?.isFocused()),
    onNotificationClick: () => showPanelWindow('sessions'),
    onAttentionChanged: count => {
      notificationAttentionCount = count
      syncTrayAttention()
    },
  })

  desktopTray = new DesktopTrayController(
    join(__dirname, '..', 'build', 'icon.png'),
    {
      getPreferences: currentDesktopPreferences,
      updatePreferences: patch => { updateDesktopPreferences(patch) },
      isPetVisible: () => Boolean(petWindow?.isVisible()),
      showPet: showPetWindow,
      hidePet: hidePetWindow,
      openPanel: () => showPanelWindow('sessions'),
      openSettings: () => showPanelWindow('settings'),
      getPetMode: () => petWindowMode,
      toggleMiniMode,
      quit: () => app.quit(),
    },
  )
  desktopTray.create()
}

function getPetsJsonPath(): string {
  if (app.isPackaged) {
    return join(app.getAppPath(), 'dist', 'pets', 'pets.json')
  }
  return join(__dirname, '..', 'dist', 'pets', 'pets.json')
}

function availablePetIds(): Set<string> {
  const ids = new Set<string>()
  try {
    const raw = JSON.parse(fs.readFileSync(getPetsJsonPath(), 'utf-8'))
    if (Array.isArray(raw)) {
      for (const pet of raw) {
        if (pet && typeof pet.id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(pet.id)) ids.add(pet.id)
      }
    }
  } catch {}

  const customBase = path.resolve(hookScriptDeployPath(), 'custom')
  try {
    for (const entry of fs.readdirSync(customBase, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9._-]{1,128}$/.test(entry.name)) continue
      const petJsonPath = safeJoin(customBase, entry.name, 'pet.json')
      if (!petJsonPath || !fs.existsSync(petJsonPath)) continue
      try {
        const pet = JSON.parse(fs.readFileSync(petJsonPath, 'utf-8'))
        const id = typeof pet.id === 'string' ? pet.id : entry.name
        if (/^[A-Za-z0-9._-]{1,128}$/.test(id)) ids.add(id)
      } catch {}
    }
  } catch {}
  ids.add('aang-airbender')
  return ids
}

let availablePetIdsCache: { ids: Set<string>; expiresAt: number } | null = null
const AVAILABLE_PET_IDS_CACHE_MS = 5_000

// Live event ingestion calls this on every tool-call/state event; re-reading
// pets.json plus the whole custom-pets directory that often would add a
// second batch of synchronous disk I/O to the same hot path project routing
// already had to be freed of. User-initiated calls (pick/bind/list) skip
// this and always read fresh.
function availablePetIdsCached(): Set<string> {
  const now = Date.now()
  if (availablePetIdsCache && availablePetIdsCache.expiresAt > now) return availablePetIdsCache.ids
  const ids = availablePetIds()
  availablePetIdsCache = { ids, expiresAt: now + AVAILABLE_PET_IDS_CACHE_MS }
  return ids
}

function createProjectRoutingServices(): void {
  if (projectRoutingStore) return
  try {
    projectRoutingStore = new ProjectRoutingStore(
      join(app.getPath('userData'), 'project-routing.sqlite'),
      { defaultPetId: 'aang-airbender' },
    )
  } catch (error) {
    console.error('Project routing storage is unavailable', error)
    projectRoutingStore = null
  }
}

function rawProjectPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = (input as Record<string, unknown>).project
  return typeof value === 'string' ? value : undefined
}

function projectViewList(): ProjectPetView[] {
  return projectRoutingStore?.listProjects(availablePetIds()) ?? []
}

async function normalizeIngressEvent(input: unknown, receivedAt?: number) {
  const normalized = await agentAdapterRegistry?.normalize(input, receivedAt)
  if (!normalized) return { ok: false as const, error: 'adapter_registry_unavailable' }
  if (!normalized.ok || !projectRoutingStore) return normalized

  try {
    const available = availablePetIdsCached()
    const identity = projectRoutingStore.trackSeen(rawProjectPath(input), receivedAt)
    if (!identity) return normalized
    const route = projectRoutingStore.route(identity.projectId, available)
    if (route.fallback) {
      console.warn(`Project pet binding for ${identity.displayName} is unavailable; using default pet.`)
    }
    return {
      ok: true as const,
      event: {
        ...normalized.event,
        project: identity.displayName,
        projectId: identity.projectId,
        ...(route.petId ? { routedPetId: route.petId } : {}),
      },
    }
  } catch (error) {
    console.error('Project routing failed; preserving unbound event behavior', error)
    return normalized
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return

  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  eventToken = refreshInstalledIntegrationScripts()
  agentAdapterRegistry = createAgentAdapterRegistry(createAgentAdapterOperations())
  projectMcpRegistry = new ProjectMcpRegistryStore(
    join(app.getPath('userData'), 'project-mcp-registry.json'),
  )
  createProjectRoutingServices()
  const permissionToken = ensurePermissionToken()
  const presentationToken = ensurePresentationToken()
  configureSecureProtocol()
  createDesktopServices()
  createPetWindow()
  createPanelWindow()
  powerMonitor.on('on-battery', broadcastPowerSaveState)
  powerMonitor.on('on-ac', broadcastPowerSaveState)
  broadcastPowerSaveState()
  createPresentationServices(presentationToken)
  screen.on('display-added', rehomePetWindowForDisplayChange)
  screen.on('display-removed', rehomePetWindowForDisplayChange)
  screen.on('display-metrics-changed', rehomePetWindowForDisplayChange)
  createPermissionServices(permissionToken)
  createProgressionServices()
  createAchievementServices()
  createHistoryServices()

  eventServer = createEventServer(
    () => [petWindow, panelWindow].filter((w): w is BrowserWindow => w !== null),
    eventToken,
    (event) => {
      if (event.originalEvent === 'AgentPetsIntegrationTest') {
        pendingIntegrationTests.get(event.sessionId)?.()
      }
      try {
        desktopNotifications?.handleEvent(event)
      } catch {
        console.error('Desktop notification handling failed')
      }
      let progressionResult: ReturnType<ProgressionStore['handleEvent']> | undefined
      try {
        progressionResult = progressionStore?.handleEvent(event, event.routedPetId)
        if (progressionResult) broadcastProgression(progressionResult.snapshot)
      } catch (error) {
        console.error('Progression event handling failed', error)
      }
      try {
        // Achievement rules only depend on terminal completions and explicit
        // token usage. Do not open the achievement SQLite transaction for the
        // high-frequency thinking/tool-running heartbeat events that carry no
        // new fact; this keeps the additive subsystem off the hot path.
        if (
          currentDesktopPreferences().achievementsEnabled
          && achievementStore
          && (event.state === 'success' || event.tokenUsage !== undefined)
        ) {
          const routedPetId = event.routedPetId ?? progressionResult?.snapshot.petId ?? progressionStore?.getActivePetId() ?? 'aang-airbender'
          const unlocks = achievementStore.recordEvent(event, routedPetId, progressionResult?.snapshot)
          unlocks.forEach(broadcastAchievementUnlock)
        }
      } catch (error) {
        console.error('Achievement event handling failed', error)
        logAchievementDiagnostic('recordEvent', error, event)
      }
      try {
        const routedPetId = event.routedPetId ?? progressionStore?.getActivePetId() ?? 'aang-airbender'
        if (historyStore?.recordEvent(event, routedPetId)) {
          broadcastHistoryUpdated()
        }
      } catch (error) {
        console.error('History event handling failed', error)
      }
    },
    normalizeIngressEvent,
  )

  // Dragging is driven from here by polling the OS cursor position, rather
  // than by accumulating deltas between renderer mousemove events. On
  // Windows, moving a frameless window while the cursor stays put makes the
  // OS resend a synthetic mousemove for the window's new position; treating
  // that as further user movement (as a delta-from-previous-event scheme
  // would) re-moves the window again, which resends another synthetic
  // event — a feedback loop that shows up as the pet continuously sliding
  // (typically downward) for as long as the button is held, even with the
  // physical mouse stationary. screen.getCursorScreenPoint() reads the true
  // OS cursor position and is unaffected by window-move-induced events, so
  // it can't feed back on itself this way.
  ipcMain.on('pet-drag-start', (event) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    clearEdgeDwell()
    if (shimejiPersistHandle) {
      clearTimeout(shimejiPersistHandle)
      shimejiPersistHandle = null
    }
    if (petWindowMode !== 'normal') applyNormalPetBounds()
    // A normal drag establishes a new restore point; it must not inherit an
    // obsolete Edge snapshot from an earlier interaction.
    edgeRestoreBounds = null
    if (dragPollHandle) {
      clearInterval(dragPollHandle)
      dragPollHandle = null
    }
    const startCursor = screen.getCursorScreenPoint()
    const [startX, startY] = petWindow.getPosition()
    let lastAppliedX = startX
    let lastAppliedY = startY
    anchorBottomCenter = null
    panelWindow?.hide()

    dragPollHandle = setInterval(() => {
      if (!petWindow) {
        if (dragPollHandle) clearInterval(dragPollHandle)
        dragPollHandle = null
        return
      }
      const cursor = screen.getCursorScreenPoint()
      const targetX = startX + (cursor.x - startCursor.x)
      const targetY = startY + (cursor.y - startCursor.y)
      // Skip the call entirely when the cursor hasn't actually moved since
      // the last tick. Calling setPosition() on an always-on-top window
      // re-asserts its z-order every time even when the coordinates are
      // unchanged, and on Windows that repeated no-op churn (125x/sec here)
      // is what was seen as the pet slowly sliding down while held with a
      // perfectly still mouse — a still cursor doesn't mean zero setPosition
      // calls unless we explicitly guard for it.
      if (targetX === lastAppliedX && targetY === lastAppliedY) return
      lastAppliedX = targetX
      lastAppliedY = targetY
      petWindow.setPosition(targetX, targetY)
    }, 8)
  })

  // Fired once when a drag ends (not per mousemove) so we're not hitting
  // disk on every pixel of movement.
  ipcMain.on('pet-drag-end', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    if (dragPollHandle) {
      clearInterval(dragPollHandle)
      dragPollHandle = null
    }
    const [x, y] = petWindow.getPosition()
    const [width, height] = petWindow.getSize()
    normalPetBounds = { x, y, width, height }
    edgeRestoreBounds = null
    persistCurrentPetWindowState()
    const moved = payload && typeof payload === 'object'
      && (payload as Record<string, unknown>).moved === true
    if (moved) scheduleEdgeDwell()
  })

  ipcMain.on('pet-window-hover', (event) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    if (petWindowMode === 'edge') applyNormalPetBounds()
  })

  // 自主走動只接受 renderer 請求的有限 step；native bounds、display 選擇
  // 與所有安全閘門都由 main process 擁有，Shimeji 不會取得通用移動 API。
  ipcMain.on('shimeji-walk-step', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawDelta = data.deltaX
    if (typeof rawDelta !== 'number' || !Number.isFinite(rawDelta)) return
    const preferences = currentDesktopPreferences()
    if (!preferences.shimejiEnabled || preferences.dndEnabled) return
    if (petWindowMode !== 'normal' || dragPollHandle || (permissionBroker?.listRequests().length ?? 0) > 0) return
    // 電池模式是 native 的省電訊號；跳過自主移動，避免與使用者目前的
    // 工作負載競爭資源。
    if (currentPowerSaveState()) return

    const deltaX = Math.round(Math.max(-24, Math.min(24, rawDelta)))
    if (deltaX === 0) return
    const current = petWindow.getBounds()
    const display = displayForBounds(current)
    const target = clampWindowBounds({ ...current, x: current.x + deltaX }, display.workArea)
    const targetDisplay = displayForBounds(target)
    if (targetDisplay.id !== display.id) return
    if (target.x === current.x && target.y === current.y) return
    petWindow.setPosition(target.x, target.y)
    normalPetBounds = target
    scheduleShimejiPositionPersist()
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
    showPanelWindow('sessions')
  })

  ipcMain.on('panel-resize', (event, payload: unknown) => {
    if (!panelWindow || !isTrustedIpcSender(event, panelWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const height = finiteNumber(data.height)
    if (height === null) return
    const requestedWidth = finiteNumber(data.width)
    const width = requestedWidth === null
      ? panelWindow.getBounds().width
      : Math.round(clamp(requestedWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH))
    panelWindow.setBounds(computePanelBounds(Math.round(clamp(height, 160, 900)), width))
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
    if (petWindowMode !== 'normal') {
      const current = edgeRestoreBounds ?? normalPetBounds ?? petWindow.getBounds()
      const next = { ...current, width, height }
      normalPetBounds = next
      if (edgeRestoreBounds) edgeRestoreBounds = { ...next }
      persistCurrentPetWindowState()
      return
    }
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

    persistPetBounds(newX, newY, width, height)
  })

  // The renderer measures its own painted content (sprite + status lines) and
  // reports it here so the panel can sit right against the pet instead of
  // against the transparent tooltip headroom above it.
  ipcMain.on('pet-content-height', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawHeight = finiteNumber(data.height)
    if (rawHeight === null) return
    const next = Math.round(clamp(rawHeight, 40, 1_600))
    if (next === petContentHeight) return
    petContentHeight = next
    repositionVisiblePanel()
  })

  ipcMain.handle('pet-window-mode-set', (event, mode: unknown) => {
    assertTrustedIpcSender(event)
    if (mode !== 'normal' && mode !== 'mini') return petModeState()
    setPetWindowMode(mode)
    return petModeState()
  })

  ipcMain.handle('pet-window-mode-init', (event) => {
    assertTrustedIpcSender(event)
    return petModeState()
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

  ipcMain.handle('desktop-preferences-init', (event, legacySoundEnabled?: unknown) => {
    assertTrustedIpcSender(event)
    if (!desktopPreferences) throw new Error('Desktop preferences are not ready')
    const preferences = desktopPreferences.initializeLegacySound(legacySoundEnabled === true)
    desktopTray?.rebuild()
    broadcastDesktopPreferences(preferences)
    return preferences
  })

  ipcMain.handle('desktop-preferences-set', (event, patch: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    return updateDesktopPreferences(patch)
  })

  ipcMain.handle('power-save-state', (event) => {
    assertTrustedIpcSender(event)
    return currentPowerSaveState()
  })

  ipcMain.on('presentation-status-update', (event, payload: unknown) => {
    if (!petWindow || !isTrustedIpcSender(event, petWindow)) return
    presentationStatusProjection = normalizePresentationStatus(payload)
  })

  ipcMain.handle('progression-init', (event, petId?: unknown) => {
    assertTrustedIpcSender(event)
    if (petId !== undefined && !isProgressionPetId(petId)) return null
    return setActiveProgressionPet(typeof petId === 'string' ? petId : 'aang-airbender')
  })

  ipcMain.handle('progression-set-pet', (event, petId: unknown) => {
    assertTrustedIpcSender(event)
    if (!isProgressionPetId(petId)) return null
    return setActiveProgressionPet(petId)
  })

  ipcMain.handle('achievements-init', (event, petId?: unknown): AchievementSnapshot | null => {
    assertTrustedIpcSender(event)
    if (!achievementStore) return null
    const selectedPet = petId === undefined
      ? progressionStore?.getActivePetId() ?? 'aang-airbender'
      : isProgressionPetId(petId) ? petId : null
    return selectedPet ? achievementStore.getSnapshot(selectedPet) : null
  })

  ipcMain.handle('permission-requests-init', (event) => {
    assertTrustedIpcSender(event)
    return permissionBroker?.listRequests() ?? []
  })

  ipcMain.handle('permission-decide', async (event, payload: unknown) => {
    assertTrustedIpcSender(event, petWindow)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'invalid_decision' }
    }
    const data = payload as Record<string, unknown>
    if (
      typeof data.requestId !== 'string'
      || (data.decision !== 'allow_once' && data.decision !== 'deny')
    ) {
      return { ok: false, error: 'invalid_decision' }
    }
    if (!permissionBroker) return { ok: false, error: 'not_found' }
    return permissionBroker.decide(data.requestId, data.decision, 'bubble')
  })

  ipcMain.handle('integration-status', async (event) => {
    assertTrustedIpcSender(event, panelWindow)
    return {
      adapters: await agentAdapterRegistry?.listStatuses() ?? [],
    }
  })

  ipcMain.handle('adapter-diagnose', async (event, id: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (!isAgentAdapterId(id)) return { ok: false, error: 'Unsupported adapter' }
    const report = await agentAdapterRegistry?.diagnose(id)
    return report ? { ok: true, report } : { ok: false, error: 'Adapter unavailable' }
  })

  ipcMain.handle('adapter-install', async (event, id: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (!isAgentAdapterId(id) || id === 'generic-http') {
      return { ok: false, error: 'Adapter is not installable' }
    }
    try {
      const status = await agentAdapterRegistry?.install(id)
      return status ? { ok: true, status } : { ok: false, error: 'Adapter unavailable' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('adapter-uninstall', async (event, id: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (!isAgentAdapterId(id) || id === 'generic-http') {
      return { ok: false, error: 'Adapter is not uninstallable' }
    }
    try {
      const status = await agentAdapterRegistry?.uninstall(id)
      return status ? { ok: true, status } : { ok: false, error: 'Adapter unavailable' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('quota-usage', async (event, force?: unknown) => {
    assertTrustedIpcSender(event)
    const usage = await getQuotaUsage(force === true)
    try {
      if (historyStore?.recordQuotaSnapshot(usage)) broadcastHistoryUpdated()
    } catch (error) {
      console.error('History quota snapshot failed', error)
    }
    for (const win of [petWindow, panelWindow]) {
      if (win && !win.isDestroyed()) win.webContents.send('quota-usage-updated', usage)
    }
    return usage
  })

  ipcMain.handle('history-summary', async (event, projectId: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    await refreshLocalUsage()
    return currentHistorySummary(typeof projectId === 'string' ? projectId : undefined)
  })

  ipcMain.handle('history-clear', (event): HistoryClearResult => {
    assertTrustedIpcSender(event, panelWindow)
    if (!historyStore) return { ok: false, error: 'unavailable' }
    try {
      historyStore.clear()
      broadcastHistoryUpdated()
      return { ok: true }
    } catch {
      return { ok: false, error: 'unavailable' }
    }
  })

  ipcMain.handle('history-export', async (event): Promise<HistoryCommandResult> => {
    assertTrustedIpcSender(event, panelWindow)
    if (!historyStore) return { ok: false, error: 'unavailable' }
    await refreshLocalUsage()
    const defaultName = `agent-pets-history-${new Date().toISOString().slice(0, 10)}.json`
    const saveOptions = {
      title: '匯出 History',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const result = panelWindow
      ? await dialog.showSaveDialog(panelWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
    try {
      writeJsonAtomic(result.filePath, historyStore.getExport(progressionStore?.getActivePetId() ?? 'aang-airbender'))
      return { ok: true, path: result.filePath }
    } catch {
      return { ok: false, error: 'write_failed' }
    }
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

  ipcMain.handle('project-pets-list', (event): ProjectPetView[] => {
    assertTrustedIpcSender(event, panelWindow)
    try {
      return projectViewList()
    } catch (error) {
      console.error('Project pet list failed', error)
      return []
    }
  })

  ipcMain.handle('project-pets-get-enabled', (event): boolean => {
    assertTrustedIpcSender(event, panelWindow)
    return projectRoutingStore?.isEnabled() ?? false
  })

  ipcMain.handle('project-pets-set-enabled', (event, value: unknown): boolean => {
    assertTrustedIpcSender(event, panelWindow)
    if (!projectRoutingStore) return false
    try {
      projectRoutingStore.setEnabled(value === true)
      return projectRoutingStore.isEnabled()
    } catch (error) {
      console.error('Project pet enable toggle failed', error)
      return projectRoutingStore.isEnabled()
    }
  })

  ipcMain.handle('project-pets-pick', async (event): Promise<ProjectPetCommandResult> => {
    assertTrustedIpcSender(event, panelWindow)
    if (!projectRoutingStore) return { ok: false, error: 'unavailable' }
    const owner = panelWindow ?? petWindow
    if (!owner || owner.isDestroyed() || dialogOpen) return { ok: false, error: 'unavailable' }

    dialogOpen = true
    let result: Electron.OpenDialogReturnValue
    try {
      result = await dialog.showOpenDialog(owner, {
        title: t('chooseProjectPet'),
        message: t('chooseProjectPetHelp'),
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch {
      return { ok: false, error: 'unavailable' }
    } finally {
      dialogOpen = false
    }
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'cancelled' }

    try {
      const project = projectRoutingStore.registerPath(result.filePaths[0], Date.now(), availablePetIds())
      return project ? { ok: true, project } : { ok: false, error: 'invalid_project' }
    } catch (error) {
      console.error('Project pet registration failed', error)
      return { ok: false, error: 'unavailable' }
    }
  })

  ipcMain.handle('project-pets-bind', (event, payload: unknown): ProjectPetCommandResult => {
    assertTrustedIpcSender(event, panelWindow)
    if (!projectRoutingStore || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'unavailable' }
    }
    const input = payload as Record<string, unknown>
    const projectId = typeof input.projectId === 'string' ? input.projectId : ''
    const petId = input.petId === null ? null : typeof input.petId === 'string' ? input.petId : undefined
    if (!/^[a-f0-9]{32}$/.test(projectId)) return { ok: false, error: 'invalid_project' }
    if (petId === undefined) return { ok: false, error: 'invalid_pet' }
    const available = availablePetIds()
    if (petId !== null && (!/^[A-Za-z0-9._-]{1,128}$/.test(petId) || !available.has(petId))) {
      return { ok: false, error: 'invalid_pet' }
    }
    try {
      const project = projectRoutingStore.setBinding(projectId, petId, available)
      return project ? { ok: true, project } : { ok: false, error: 'not_found' }
    } catch (error) {
      console.error('Project pet binding failed', error)
      return { ok: false, error: 'unavailable' }
    }
  })

  ipcMain.handle('project-pets-archive', (event, projectId: unknown): ProjectPetArchiveResult => {
    assertTrustedIpcSender(event, panelWindow)
    if (!projectRoutingStore) return { ok: false, error: 'unavailable' }
    if (typeof projectId !== 'string' || !/^[a-f0-9]{32}$/.test(projectId)) {
      return { ok: false, error: 'invalid_project' }
    }
    try {
      return projectRoutingStore.archiveProject(projectId) ? { ok: true } : { ok: false, error: 'not_found' }
    } catch (error) {
      console.error('Project pet archive failed', error)
      return { ok: false, error: 'unavailable' }
    }
  })

  ipcMain.handle('project-mcp-setup', async (event) => {
    assertTrustedIpcSender(event, panelWindow)
    const owner = panelWindow ?? petWindow
    if (!owner || owner.isDestroyed()) {
      return { ok: false, results: [], error: 'No settings window is available' }
    }
    if (dialogOpen) {
      return { ok: false, results: [], error: 'Another dialog is already open' }
    }

    dialogOpen = true
    let result: Electron.OpenDialogReturnValue
    try {
      result = await dialog.showOpenDialog(owner, {
        title: '將 Agent Pets MCP 安裝到專案',
        message: '選擇本機專案資料夾',
        properties: ['openDirectory', 'createDirectory'],
      })
    } catch (error) {
      return {
        ok: false,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      dialogOpen = false
    }

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true, results: [] }
    }

    try {
      // The bridge is refreshed on app startup, but refresh here as well so a
      // project setup remains self-healing after an upgrade or interrupted copy.
      ensurePresentationMcpScript()
      const summary = installProjectMcp(result.filePaths[0], {
        nodeExecutable: resolveNodeBin(),
        bridgePath: presentationMcpScriptPath(),
      })
      if (summary.projectPath && projectMcpRegistry) {
        try {
          projectMcpRegistry.register(summary.projectPath)
        } catch (registryError) {
          return {
            ...summary,
            ok: false,
            error: registryError instanceof Error ? registryError.message : String(registryError),
          }
        }
      }
      return summary
    } catch (error) {
      return {
        ok: false,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('project-mcp-list', (event): ProjectMcpRegistrySnapshot => {
    assertTrustedIpcSender(event, panelWindow)
    if (!projectMcpRegistry) return { ok: false, projects: [], error: 'Project MCP registry is unavailable' }
    try {
      ensurePresentationMcpScript()
      return projectMcpRegistry.list({
        nodeExecutable: resolveNodeBin(),
        bridgePath: presentationMcpScriptPath(),
      })
    } catch (error) {
      return {
        ok: false,
        projects: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('project-mcp-remove', (event, projectPath: unknown): ProjectMcpRemovalSummary => {
    assertTrustedIpcSender(event, panelWindow)
    const requestedPath = typeof projectPath === 'string' ? projectPath : ''
    if (!projectMcpRegistry) {
      return { ok: false, projectPath: requestedPath, results: [], error: 'Project MCP registry is unavailable' }
    }
    try {
      ensurePresentationMcpScript()
      const summary = removeProjectMcp(requestedPath, {
        nodeExecutable: resolveNodeBin(),
        bridgePath: presentationMcpScriptPath(),
      })
      if (summary.ok) projectMcpRegistry.forget(summary.projectPath)
      return summary
    } catch (error) {
      return {
        ok: false,
        projectPath: requestedPath,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('project-mcp-forget', (event, projectPath: unknown) => {
    assertTrustedIpcSender(event, panelWindow)
    if (!projectMcpRegistry || typeof projectPath !== 'string') return { ok: false, removed: false }
    try {
      return { ok: true, removed: projectMcpRegistry.forget(projectPath) }
    } catch (error) {
      return { ok: false, removed: false, error: error instanceof Error ? error.message : String(error) }
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
    let builtin: Array<{
      id: string
      displayName: string
      folder: string
      builtIn: boolean
      behaviorManifest?: SanitizedPetBehaviorManifest
    }> = []
    try {
      const raw = fs.readFileSync(builtinPath, 'utf-8')
      builtin = JSON.parse(raw).map((p: any) => {
        const behaviorManifest = parsePetBehaviorManifest(p.behaviorManifest)
        return {
          id: String(p.id || ''),
          displayName: String(p.displayName || p.id || ''),
          folder: String(p.folder || p.id || ''),
          builtIn: true,
          ...(behaviorManifest ? { behaviorManifest } : {}),
        }
      })
    } catch {}

    const customBase = path.resolve(hookScriptDeployPath(), 'custom')
    let custom: Array<{
      id: string
      displayName: string
      folder: string
      builtIn: boolean
      behaviorManifest?: SanitizedPetBehaviorManifest
    }> = []
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
          const behaviorManifest = parsePetBehaviorManifest(petData.behaviorManifest)
          custom.push({
            id: String(petData.id || safe),
            displayName: String(petData.displayName || safe),
            folder: safe,
            builtIn: false,
            ...(behaviorManifest ? { behaviorManifest } : {}),
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
      description: t('customPet'),
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
      title: '選擇寵物素材包（.codex-pet.zip）',
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
      const behaviorManifest = parsePetBehaviorManifest(petData.behaviorManifest)

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
        ...(behaviorManifest ? { behaviorManifest } : {}),
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
      title: '選擇 spritesheet（每格 192x208，.webp）',
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
      description: t('customPet'),
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
    } else {
      showPetWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  if (localUsageScanTimer) clearInterval(localUsageScanTimer)
  localUsageScanTimer = null
  localUsageReader = null
  localUsageScanPromise = null
  presentationController?.clear()
  permissionBroker?.shutdown()
  progressionStore?.close()
  progressionStore = null
  if (achievementStoreRetryTimer) clearTimeout(achievementStoreRetryTimer)
  achievementStoreRetryTimer = null
  achievementStore?.close()
  achievementStore = null
  historyStore?.close()
  historyStore = null
  projectRoutingStore?.close()
  projectRoutingStore = null
})

app.on('will-quit', () => {
  unregisterPermissionHotkeys()
  permissionRelay?.shutdown()
  permissionRelay = null
  permissionBroker = null
  permissionAdapterServer?.close()
  permissionAdapterServer = null
  desktopNotifications?.destroy()
  desktopNotifications = null
  desktopTray?.destroy()
  desktopTray = null
  presentationMcpServer?.close()
  presentationMcpServer = null
  presentationController = null
  eventServer?.close()
  eventServer = null
})

// Agent Pets is a tray application on every supported desktop platform.
// Hiding or closing its windows must not stop hooks or background status.
app.on('window-all-closed', () => {
  // Intentionally keep the main process alive until the user chooses Quit.
})
