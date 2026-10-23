import { app, BrowserWindow, MessageChannelMain, session } from 'electron'
import type { MessagePortMain } from 'electron'
import { join } from 'node:path'

export interface PluginHostDescriptor {
  id: string
  entry: string
}

export interface PluginHostControllerOptions {
  onRpc: (pluginId: string, request: unknown) => Promise<unknown> | unknown
  onPluginCrash: (pluginId: string, consecutiveCrashes: number) => void
  getMemoryBudgetMb: (activePluginCount: number) => number
  now?: () => number
}

interface PluginHostRuntime {
  descriptor: PluginHostDescriptor
  lastPongAt: number
  startedAt: number
}

const PLUGIN_SCHEME_PREFIX = 'agent-pets://plugin/'
const PING_INTERVAL_MS = 10_000
const PONG_TIMEOUT_MS = 30_000
const MEMORY_POLL_INTERVAL_MS = 30_000
const MAX_CONSECUTIVE_CRASHES = 3
const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const PLUGIN_ENTRY = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[^\\:]+\.js$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export class PluginHostWindowController {
  private readonly onRpc: PluginHostControllerOptions['onRpc']
  private readonly onPluginCrash: PluginHostControllerOptions['onPluginCrash']
  private readonly getMemoryBudgetMb: PluginHostControllerOptions['getMemoryBudgetMb']
  private readonly now: () => number
  private readonly desired = new Map<string, PluginHostDescriptor>()
  private readonly runtime = new Map<string, PluginHostRuntime>()
  private readonly crashCounts = new Map<string, number>()
  private hostWindow: BrowserWindow | null = null
  private hostPort: MessagePortMain | null = null
  private portReady = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private memoryTimer: ReturnType<typeof setInterval> | null = null
  private closingIntentionally = false

  constructor(options: PluginHostControllerOptions) {
    this.onRpc = options.onRpc
    this.onPluginCrash = options.onPluginCrash
    this.getMemoryBudgetMb = options.getMemoryBudgetMb
    this.now = options.now ?? Date.now
  }

  sync(enabledPlugins: readonly PluginHostDescriptor[]): void {
    const next = new Map<string, PluginHostDescriptor>()
    for (const plugin of enabledPlugins) {
      if (!isValidDescriptor(plugin)) continue
      next.set(plugin.id, { ...plugin })
    }
    this.desired.clear()
    for (const [id, descriptor] of next) this.desired.set(id, descriptor)

    if (this.desired.size === 0) {
      this.closeHost()
      return
    }
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      this.createHost()
      return
    }
    if (this.portReady) this.syncWorkers()
  }

  close(): void {
    this.desired.clear()
    this.closeHost()
  }

  private createHost(): void {
    const pluginSession = session.fromPartition('plugin-host')
    pluginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    pluginSession.setPermissionCheckHandler(() => false)
    pluginSession.on('will-download', event => event.preventDefault())
    pluginSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !details.url.startsWith(PLUGIN_SCHEME_PREFIX) })
    })

    const window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, 'plugin-host-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        partition: 'plugin-host',
        devTools: !app.isPackaged,
      },
    })
    this.hostWindow = window
    this.closingIntentionally = false
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.once('did-finish-load', () => this.attachHostPort(window))
    window.webContents.on('render-process-gone', () => this.handleHostCrash(window))
    window.on('closed', () => {
      if (this.hostWindow !== window) return
      this.hostWindow = null
      this.portReady = false
      this.closePort()
      this.clearTimers()
      const shouldRestart = !this.closingIntentionally && this.desired.size > 0
      if (shouldRestart) {
        for (const pluginId of this.desired.keys()) this.recordCrash(pluginId)
        if (this.desired.size > 0) setTimeout(() => this.createHost(), 250)
      }
      this.closingIntentionally = false
    })
    this.startTimers()
    void window.loadURL('agent-pets://plugin/_host/index.html').catch(() => this.handleHostCrash(window))
  }

  private attachHostPort(window: BrowserWindow): void {
    if (this.hostWindow !== window || window.isDestroyed()) return
    this.closePort()
    const channel = new MessageChannelMain()
    this.hostPort = channel.port1
    this.hostPort.on('message', event => this.handleHostMessage(event.data))
    this.hostPort.start()
    window.webContents.postMessage('plugin-host-port', null, [channel.port2])
    this.portReady = true
    this.syncWorkers()
  }

  private syncWorkers(): void {
    if (!this.portReady) return
    for (const [pluginId, state] of this.runtime) {
      if (!this.desired.has(pluginId)) {
        this.post({ type: 'stop', pluginId })
        this.runtime.delete(pluginId)
        this.crashCounts.delete(pluginId)
      } else if (this.desired.get(pluginId)?.entry !== state.descriptor.entry) {
        this.post({ type: 'stop', pluginId })
        this.runtime.delete(pluginId)
      }
    }
    const now = this.readNow()
    if (now === null) return
    for (const [pluginId, descriptor] of this.desired) {
      if (this.runtime.has(pluginId)) continue
      this.runtime.set(pluginId, { descriptor, lastPongAt: now, startedAt: now })
      this.post({ type: 'start', pluginId, entry: descriptor.entry })
    }
  }

  private handleHostMessage(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string' || typeof value.pluginId !== 'string'
      || !this.desired.has(value.pluginId)) return
    const pluginId = value.pluginId
    if (value.type === 'worker-started' || value.type === 'worker-ready') {
      const runtime = this.runtime.get(pluginId)
      if (runtime) runtime.lastPongAt = this.readNow() ?? runtime.lastPongAt
      return
    }
    if (value.type === 'pong') {
      const runtime = this.runtime.get(pluginId)
      if (runtime) runtime.lastPongAt = this.readNow() ?? runtime.lastPongAt
      return
    }
    if (value.type === 'worker-crash') {
      this.recordCrash(pluginId)
      return
    }
    if (value.type === 'rpc') {
      void Promise.resolve()
        .then(() => this.onRpc(pluginId, value.request))
        .then(result => this.post({ type: 'rpc-result', pluginId, result }))
        .catch(() => this.post({ type: 'rpc-result', pluginId, result: { ok: false, error: 'invalid_request' } }))
    }
  }

  private startTimers(): void {
    this.clearTimers()
    this.pingTimer = setInterval(() => this.pingWorkers(), PING_INTERVAL_MS)
    this.memoryTimer = setInterval(() => this.checkMemory(), MEMORY_POLL_INTERVAL_MS)
  }

  private pingWorkers(): void {
    if (!this.portReady || this.desired.size === 0) return
    const now = this.readNow()
    if (now === null) return
    this.post({ type: 'ping', at: now })
    for (const [pluginId, runtime] of this.runtime) {
      if (now - runtime.startedAt >= PONG_TIMEOUT_MS) this.crashCounts.delete(pluginId)
      if (now - runtime.lastPongAt >= PONG_TIMEOUT_MS) {
        this.post({ type: 'terminate', pluginId })
        this.recordCrash(pluginId)
      }
    }
  }

  private checkMemory(): void {
    const window = this.hostWindow
    if (!window || window.isDestroyed() || this.desired.size === 0) return
    const pid = window.webContents.getOSProcessId()
    const metric = app.getAppMetrics().find(item => item.pid === pid)
    const workingSetKb = metric?.memory.workingSetSize
    const budget = this.getMemoryBudgetMb(this.desired.size)
    if (!Number.isFinite(workingSetKb) || !Number.isFinite(budget) || budget <= 0) return
    if ((workingSetKb ?? 0) / 1024 <= budget) return
    for (const pluginId of this.desired.keys()) this.recordCrash(pluginId)
    this.closingIntentionally = true
    window.destroy()
    this.hostWindow = null
    this.portReady = false
    this.closePort()
    this.clearTimers()
    if (this.desired.size > 0) setTimeout(() => this.createHost(), 250)
  }

  private handleHostCrash(window: BrowserWindow): void {
    if (this.hostWindow !== window || window.isDestroyed()) return
    this.closingIntentionally = true
    window.destroy()
  }

  private recordCrash(pluginId: string): void {
    const count = (this.crashCounts.get(pluginId) ?? 0) + 1
    this.crashCounts.set(pluginId, count)
    this.runtime.delete(pluginId)
    this.onPluginCrash(pluginId, count)
    if (count >= MAX_CONSECUTIVE_CRASHES) {
      this.desired.delete(pluginId)
      this.post({ type: 'terminate', pluginId })
    } else if (this.portReady && this.desired.has(pluginId)) {
      setTimeout(() => {
        const descriptor = this.desired.get(pluginId)
        if (!descriptor || this.runtime.has(pluginId) || !this.portReady) return
        const now = this.readNow()
        if (now === null) return
        this.runtime.set(pluginId, { descriptor, lastPongAt: now, startedAt: now })
        this.post({ type: 'start', pluginId, entry: descriptor.entry })
      }, 250)
    }
  }

  private post(message: unknown): void {
    try { this.hostPort?.postMessage(message) } catch {}
  }

  private closePort(): void {
    try { this.hostPort?.close() } catch {}
    this.hostPort = null
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.memoryTimer) clearInterval(this.memoryTimer)
    this.pingTimer = null
    this.memoryTimer = null
  }

  private closeHost(): void {
    this.runtime.clear()
    this.crashCounts.clear()
    this.portReady = false
    this.closePort()
    this.clearTimers()
    const window = this.hostWindow
    if (!window || window.isDestroyed()) {
      this.hostWindow = null
      return
    }
    this.closingIntentionally = true
    window.close()
    if (!window.isDestroyed()) window.destroy()
    this.hostWindow = null
  }

  private readNow(): number | null {
    try {
      const now = this.now()
      return Number.isSafeInteger(now) && now >= 0 ? now : null
    } catch {
      return null
    }
  }
}

function isValidDescriptor(value: unknown): value is PluginHostDescriptor {
  if (!isRecord(value) || typeof value.id !== 'string' || !PLUGIN_ID.test(value.id)
    || typeof value.entry !== 'string' || value.entry.length > 512 || !PLUGIN_ENTRY.test(value.entry)) return false
  return !value.entry.split('/').some(segment => !segment || segment === '.' || segment === '..')
}
