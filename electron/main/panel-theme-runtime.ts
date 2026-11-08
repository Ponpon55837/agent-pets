import { createHmac, randomBytes } from 'node:crypto'
import {
  buildPanelThemeState,
  checkPanelThemePackagedImage,
  checkPanelThemeUserImage,
  emptyPanelThemeState,
  isWoff2,
  PANEL_THEME_FONT_MAX_BYTES,
  PANEL_THEME_IMAGE_MAX_BYTES,
  PANEL_THEME_USER_IMAGE_MAX_BYTES,
  resolvePanelThemes,
  type PanelThemeSourcePlugin,
  type ResolvedPanelTheme,
} from '../plugin-panel-themes.ts'
import { PanelThemeStore, PANEL_THEME_USER_IMAGE_FILE } from '../panel-theme-store.ts'
import { panelThemePluginImageDirectory, removePluginImages, sweepOrphanUserImages, deleteUserImage } from '../panel-theme-images.ts'
import type { PluginLocalizedText, PluginManifest } from '../../src/types/plugin.ts'
import type { PanelThemeMode, PanelThemeState } from '../../src/types/panel-theme.ts'

// Main-process owner of plugin panel themes: the store, the per-session
// salt, the token -> asset map served by `agent-pets://panel-theme/<token>`,
// the resolved-theme cache, and the state broadcast (spec §7).

type AssetKind = 'image' | 'font' | 'user'

interface TokenAsset {
  kind: AssetKind
  root: string
  relativePath: string
  maxBytes: number
}

export interface PanelThemeRegistryEntry {
  id: string
  currentVersion: string
  status: string
}

export interface PanelThemeRuntimeContext {
  manifest: Pick<PluginManifest, 'name' | 'contributes'>
  enabled: boolean
  pluginsEnabled: boolean
}

export interface PanelThemeSyncInput {
  registry: readonly PanelThemeRegistryEntry[]
  contexts: ReadonlyMap<string, PanelThemeRuntimeContext>
  pluginsEnabled: boolean
}

export interface PanelThemeRuntimeOptions {
  userDataDirectory: string
  pluginRoot(pluginId: string, version: string): string
  readRegularFileWithin(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array | null>
  /** Sends the new state to the panel window only. */
  send(state: PanelThemeState): void
  /** Origin allowed to read fonts cross-origin (the trusted panel renderer). */
  rendererOrigin(): string | null
  salt?: Uint8Array
}

const TOKEN_PATH = /^\/([0-9a-f]{32})$/
const MAX_RESOLVED_CACHE = 64

function hmacHex(salt: Uint8Array, value: string): string {
  return createHmac('sha256', salt).update(value, 'utf8').digest('hex')
}

export class PanelThemeRuntime {
  readonly store: PanelThemeStore
  private readonly options: PanelThemeRuntimeOptions
  private readonly salt: Uint8Array
  private readonly resolvedCache = new Map<string, ResolvedPanelTheme[] | null>()
  private sources: PanelThemeSourcePlugin[] = []
  private tokens = new Map<string, TokenAsset>()
  private state: PanelThemeState = emptyPanelThemeState()
  private stateHash = ''
  private installed = new Set<string>()
  private knownManifests = new Set<string>()

  constructor(options: PanelThemeRuntimeOptions) {
    this.options = options
    this.salt = options.salt ?? randomBytes(32)
    this.store = new PanelThemeStore(options.userDataDirectory)
  }

  getState(): PanelThemeState {
    return this.state
  }

  getSources(): readonly PanelThemeSourcePlugin[] {
    return this.sources
  }

  /** Re-derives sources from the plugin runtime, prunes the store, and publishes on change. */
  sync(input: PanelThemeSyncInput): void {
    const sources: PanelThemeSourcePlugin[] = []
    const liveKeys = new Set<string>()
    this.installed = new Set(input.registry.map(entry => entry.id))
    this.knownManifests = new Set()
    for (const entry of input.registry) {
      const context = input.contexts.get(entry.id)
      const cacheKey = `${entry.id}@${entry.currentVersion}`
      liveKeys.add(cacheKey)
      let themes: ResolvedPanelTheme[] | null | undefined = this.resolvedCache.get(cacheKey)
      if (context) {
        this.knownManifests.add(entry.id)
        if (themes === undefined) {
          const declared = context.manifest.contributes.panelThemes
          themes = declared?.length ? resolvePanelThemes(declared) : null
          this.resolvedCache.set(cacheKey, themes)
        }
      }
      if (!themes?.length) continue
      const statusOk = entry.status === 'installed' || entry.status === 'enabled'
      const available = Boolean(context && statusOk && context.enabled && context.pluginsEnabled && input.pluginsEnabled)
      sources.push({
        pluginId: entry.id,
        version: entry.currentVersion,
        pluginName: context ? { ...context.manifest.name } : fallbackName(entry.id),
        available,
        ...(available ? {} : { unavailableReason: input.pluginsEnabled ? 'plugin_disabled' as const : 'plugins_off' as const }),
        themes,
      })
    }
    for (const key of [...this.resolvedCache.keys()]) {
      if (!liveKeys.has(key) || this.resolvedCache.size > MAX_RESOLVED_CACHE) this.resolvedCache.delete(key)
    }
    this.sources = sources
    this.prune()
    this.publish()
  }

  /** Rebuilds state and token map from the current sources and store; sends when the state changed. */
  publish(): void {
    const tokens = new Map<string, TokenAsset>()
    const imagesRoot = this.options.userDataDirectory
    const record = (token: string, asset: TokenAsset) => {
      tokens.set(token, asset)
      return `agent-pets://panel-theme/${token}`
    }
    const state = buildPanelThemeState(this.sources, this.store.get(), {
      packagedUrl: (kind, pluginId, version, relativePath) => {
        const token = hmacHex(this.salt, `${kind}\u0000${pluginId}\u0000${version}\u0000${relativePath}`).slice(0, 32)
        return record(token, {
          kind,
          root: this.options.pluginRoot(pluginId, version),
          relativePath,
          maxBytes: kind === 'font' ? PANEL_THEME_FONT_MAX_BYTES : PANEL_THEME_IMAGE_MAX_BYTES,
        })
      },
      fontAlias: (pluginId, version, themeId, fontId) => (
        `apt-${hmacHex(this.salt, `${pluginId}\u0000${version}\u0000${themeId}\u0000${fontId}`).slice(0, 16)}`
      ),
      userImageUrl: (pluginId, file) => {
        const directory = panelThemePluginImageDirectory(imagesRoot, pluginId)
        if (!directory || !PANEL_THEME_USER_IMAGE_FILE.test(file)) return null
        const token = hmacHex(this.salt, `user\u0000${file.slice(0, 64)}`).slice(0, 32)
        return record(token, { kind: 'user', root: directory, relativePath: file, maxBytes: PANEL_THEME_USER_IMAGE_MAX_BYTES })
      },
    })
    this.tokens = tokens
    this.state = state
    const hash = JSON.stringify(state)
    if (hash === this.stateHash) return
    this.stateHash = hash
    this.options.send(state)
  }

  /** Plugin removed: drop slots, store entries and its image directory. */
  removePlugin(pluginId: string): void {
    try { this.store.removePlugin(pluginId) } catch {}
    removePluginImages(this.options.userDataDirectory, pluginId)
  }

  /** Startup sweep of unreferenced image files (bounded). */
  sweep(): number {
    return sweepOrphanUserImages(this.options.userDataDirectory, this.store.referencedFiles())
  }

  private prune(): void {
    let removed: string[] = []
    try {
      removed = this.store.prune({
        isInstalled: pluginId => this.installed.has(pluginId),
        modeExists: (pluginId, themeId, mode) => this.modeKnown(pluginId, themeId, mode, false),
        allowsUserImage: (pluginId, themeId, mode) => this.modeKnown(pluginId, themeId, mode, true),
      })
    } catch {
      return
    }
    for (const entry of removed) {
      const separator = entry.indexOf('/')
      deleteUserImage(this.options.userDataDirectory, entry.slice(0, separator), entry.slice(separator + 1))
    }
  }

  /** Unknown manifests (e.g. crash-disabled plugins) are kept, never pruned. */
  private modeKnown(pluginId: string, themeId: string, mode: PanelThemeMode, needsUserImage: boolean): boolean {
    if (!this.knownManifests.has(pluginId)) return true
    const theme = this.sources.find(source => source.pluginId === pluginId)?.themes.find(candidate => candidate.id === themeId)
    const resolved = theme?.modes[mode]
    return Boolean(resolved && (!needsUserImage || resolved.userImage))
  }

  /** `agent-pets://panel-theme/<token>`: token-only, GET-only, header re-check on the bytes served. */
  async handleRequest(rawUrl: string, method: string): Promise<Response> {
    if (method !== 'GET') return new Response('Method not allowed', { status: 405 })
    let url: URL
    try { url = new URL(rawUrl) } catch { return notFound() }
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'panel-theme' || url.search || url.hash
      || url.username || url.password || url.port) return notFound()
    const match = TOKEN_PATH.exec(url.pathname)
    const asset = match ? this.tokens.get(match[1]!) : undefined
    if (!asset) return notFound()
    const data = await this.options.readRegularFileWithin(asset.root, asset.relativePath, asset.maxBytes)
    if (!data) return notFound()
    let contentType: string
    if (asset.kind === 'font') {
      if (!isWoff2(data) || data.byteLength > PANEL_THEME_FONT_MAX_BYTES) return notFound()
      contentType = 'font/woff2'
    } else {
      const check = asset.kind === 'user' ? checkPanelThemeUserImage(data) : checkPanelThemePackagedImage(data)
      if (!check.ok) return notFound()
      contentType = check.type
    }
    const headers: Record<string, string> = {
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
    }
    const origin = asset.kind === 'font' ? this.options.rendererOrigin() : null
    if (origin) {
      headers['access-control-allow-origin'] = origin
      headers.vary = 'Origin'
    }
    return new Response(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), { status: 200, headers })
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function fallbackName(pluginId: string): PluginLocalizedText {
  return { 'zh-TW': pluginId, 'en-US': pluginId }
}
