import { createPluginPanelProtocolHandler, type PluginProtocolRequestLike } from './plugin-protocol.ts'
import type { PluginPanelApiMethod } from './plugin-panel-view-bridge.ts'

export const PLUGIN_PANEL_PARTITION_PREFIX = 'plugin-ui-'
export const PLUGIN_PANEL_MESSAGE_MAX_BYTES = 256 * 1024

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const UUID_TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const PANEL_ENTRY_METHODS = new Set<PluginPanelApiMethod>([
  'feed.notify', 'pet.status', 'storage.get', 'storage.set', 'storage.remove',
  'settings.get', 'log.info', 'log.warn', 'log.error', 'net.fetch', 'ui.postMessage',
])
const PANEL_ERROR_CODES = new Set([
  'not_permitted', 'rate_limited', 'invalid_request', 'too_large', 'timeout', 'host_not_allowed',
  'disabled', 'queue_full', 'duplicate', 'not_found', 'too_many_enabled', 'host_unavailable',
  'too_many_redirects', 'secret_unavailable', 'secret_not_found', 'settings_invalid',
  'schedule_invalid', 'agent_status_unavailable', 'denied',
])

export interface PluginPanelViewDescriptor {
  pluginId: string
  entry: string
}

export interface PluginPanelViewWebPreferences {
  preload: string
  sandbox: true
  contextIsolation: true
  nodeIntegration: false
  webviewTag: false
  partition: string
  devTools: false
}

export interface PluginPanelViewCancelableEvent {
  preventDefault: () => void
}

export interface PluginPanelViewSession {
  protocol: {
    handle: (scheme: string, handler: (request: PluginProtocolRequestLike) => Response) => void | Promise<void>
  }
  webRequest: {
    onBeforeRequest: (
      filter: { urls: string[] },
      listener: (details: { url: string; method?: string }, callback: (decision: { cancel: boolean }) => void) => void,
    ) => void
  }
  setPermissionRequestHandler: (handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => void
  setPermissionCheckHandler: (handler: (...args: unknown[]) => boolean) => void
  on: (event: 'will-download', listener: (event: PluginPanelViewCancelableEvent) => void) => void
}

export interface PluginPanelViewWebContents {
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => void
  on: (event: string, listener: (event?: PluginPanelViewCancelableEvent) => void) => void
  loadURL: (url: string) => Promise<void>
  send: (channel: string, ...args: unknown[]) => void
  destroy: () => void
  isDestroyed: () => boolean
}

export interface PluginPanelNativeView {
  webContents: PluginPanelViewWebContents
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  setVisible: (visible: boolean) => void
}

export interface PluginPanelViewParent {
  isDestroyed: () => boolean
  addChildView: (view: PluginPanelNativeView) => void
  removeChildView: (view: PluginPanelNativeView) => void
}

export interface PluginPanelViewControllerOptions {
  preloadPath: string
  tokensCss: string
  getParentWindow: () => PluginPanelViewParent | null
  createSession: (partition: string) => PluginPanelViewSession
  createView: (options: { webPreferences: PluginPanelViewWebPreferences }) => PluginPanelNativeView
  createToken: (pluginId: string) => string
  revokeToken: (pluginId: string, token: string) => void
  pluginRootForToken: (token: string) => string | null
  onApiRequest: (pluginId: string, request: { id: string; method: string; args: unknown[] }) => unknown | Promise<unknown>
}

interface ActivePanelView {
  pluginId: string
  token: string
  parent: PluginPanelViewParent
  view: PluginPanelNativeView
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPanelEntry(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.startsWith('/')
    || value.includes('\\') || value.includes(':')) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    && value.toLowerCase().endsWith('.html')
}

function safePanelUrl(urlValue: string, token: string | null): boolean {
  if (!token || !UUID_TOKEN.test(token)) return false
  try {
    const url = new URL(urlValue)
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin' || url.username || url.password || url.port
      || url.search || url.hash || !url.pathname.startsWith('/')) return false
    const decodedSegments: string[] = []
    for (const segment of url.pathname.slice(1).split('/')) {
      let decoded: string
      try { decoded = decodeURIComponent(segment) } catch { return false }
      if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('%')) return false
      decodedSegments.push(decoded)
    }
    if (decodedSegments[0] === '_shared') return decodedSegments.length === 2 && decodedSegments[1] === 'tokens.css'
    return decodedSegments[0] === token && decodedSegments.length >= 2
  } catch {
    return false
  }
}

function isJsonValue(value: unknown, depth = 0, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > 32 || seen.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false
  seen.add(value)
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  const valid = values.length <= 50_000 && values.every(item => isJsonValue(item, depth + 1, seen))
  seen.delete(value)
  return valid
}

function errorResult(error: string): { ok: false; error: string } {
  return { ok: false, error: PANEL_ERROR_CODES.has(error) ? error : 'invalid_request' }
}

export function isPluginPanelResourceAllowed(url: string, token: string | null, method = 'GET'): boolean {
  return method === 'GET' && safePanelUrl(url, token)
}

export class PluginPanelViewController {
  private readonly options: PluginPanelViewControllerOptions
  private readonly configuredPartitions = new Set<string>()
  private readonly activeTokens = new Map<string, string>()
  private active: ActivePanelView | null = null
  private requestSequence = 0

  constructor(options: PluginPanelViewControllerOptions) {
    this.options = options
  }

  async open(descriptor: PluginPanelViewDescriptor): Promise<{ ok: true; value: { opened: true } } | { ok: false; error: string }> {
    if (!isRecord(descriptor) || typeof descriptor.pluginId !== 'string' || !PLUGIN_ID.test(descriptor.pluginId)
      || !isPanelEntry(descriptor.entry)) return errorResult('invalid_request')
    const parent = this.options.getParentWindow()
    if (!parent || parent.isDestroyed()) return errorResult('disabled')
    this.close()

    const pluginId = descriptor.pluginId
    let token: string
    try { token = this.options.createToken(pluginId) } catch { return errorResult('disabled') }
    if (!UUID_TOKEN.test(token)) {
      try { this.options.revokeToken(pluginId, token) } catch {}
      return errorResult('disabled')
    }

    const partition = `${PLUGIN_PANEL_PARTITION_PREFIX}${pluginId}`
    let view: PluginPanelNativeView | null = null
    try {
      const pluginSession = this.options.createSession(partition)
      this.configureSession(pluginId, pluginSession)
      this.activeTokens.set(pluginId, token)
      view = this.options.createView({
        webPreferences: {
          preload: this.options.preloadPath,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          partition,
          devTools: false,
        },
      })
      const active: ActivePanelView = { pluginId, token, parent, view }
      this.active = active
      view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      parent.addChildView(view)
      this.configureWebContents(active)
      const entry = descriptor.entry.split('/').map(segment => encodeURIComponent(segment)).join('/')
      await view.webContents.loadURL(`agent-pets://plugin/${token}/${entry}`)
      view.setVisible(true)
      return { ok: true, value: { opened: true } }
    } catch {
      if (view && this.active?.view !== view) {
        try { view.webContents.destroy() } catch {}
      }
      this.close()
      try { this.options.revokeToken(pluginId, token) } catch {}
      return errorResult('disabled')
    }
  }

  close(): void {
    const active = this.active
    if (!active) return
    this.active = null
    this.activeTokens.delete(active.pluginId)
    try { this.options.revokeToken(active.pluginId, active.token) } catch {}
    try { active.view.setVisible(false) } catch {}
    try { active.parent.removeChildView(active.view) } catch {}
    try {
      if (!active.view.webContents.isDestroyed()) active.view.webContents.destroy()
    } catch {}
  }

  closeIfNotAllowed(isAllowed: (pluginId: string) => boolean): void {
    if (this.active && !isAllowed(this.active.pluginId)) this.close()
  }

  closeForPlugin(pluginId: string): void {
    if (this.active?.pluginId === pluginId) this.close()
  }

  activePluginId(): string | null {
    return this.active?.pluginId ?? null
  }

  async handleApiRequest(sender: unknown, method: unknown, args: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    const active = this.active
    if (!active || active.view.webContents !== sender || active.view.webContents.isDestroyed()) return errorResult('not_permitted')
    if (typeof method !== 'string' || !PANEL_ENTRY_METHODS.has(method as PluginPanelApiMethod)
      || !Array.isArray(args) || args.length > 32 || !isJsonValue(args)) return errorResult('not_permitted')
    let serialized: string
    try { serialized = JSON.stringify(args) } catch { return errorResult('invalid_request') }
    if (Buffer.byteLength(serialized, 'utf8') > PLUGIN_PANEL_MESSAGE_MAX_BYTES) return errorResult('too_large')
    const id = `panel-${++this.requestSequence}`
    try {
      const response = await this.options.onApiRequest(active.pluginId, { id, method, args })
      if (!isRecord(response) || typeof response.ok !== 'boolean') return errorResult('invalid_request')
      if (!response.ok) return errorResult(typeof response.error === 'string' ? response.error : 'invalid_request')
      return { ok: true, value: response.value }
    } catch {
      return errorResult('disabled')
    }
  }

  private configureSession(pluginId: string, pluginSession: PluginPanelViewSession): void {
    if (this.configuredPartitions.has(pluginId)) return
    const protocolHandler = createPluginPanelProtocolHandler({
      pluginRootForToken: this.options.pluginRootForToken,
      tokensCss: this.options.tokensCss,
    })
    const protocolResult = pluginSession.protocol.handle('agent-pets', request => protocolHandler(request))
    if (protocolResult && typeof (protocolResult as Promise<void>).catch === 'function') {
      void (protocolResult as Promise<void>).catch(() => {})
    }
    pluginSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    pluginSession.setPermissionCheckHandler(() => false)
    pluginSession.on('will-download', event => event.preventDefault())
    pluginSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !isPluginPanelResourceAllowed(details.url, this.activeTokens.get(pluginId) ?? null, details.method ?? 'GET') })
    })
    this.configuredPartitions.add(pluginId)
  }

  private configureWebContents(active: ActivePanelView): void {
    const contents = active.view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview'] as const) {
      contents.on(eventName, event => event?.preventDefault())
    }
    contents.on('render-process-gone', () => {
      if (this.active === active) this.close()
    })
    contents.on('destroyed', () => {
      if (this.active === active) this.close()
    })
  }
}
