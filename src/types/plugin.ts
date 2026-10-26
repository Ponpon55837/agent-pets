export type PluginLocalizedText = {
  'zh-TW': string
  'en-US': string
}

export type PluginSettingScalar = string | number | boolean

export type PluginPanelViewCloseReason =
  | 'closed'
  | 'replaced'
  | 'load_failed'
  | 'renderer_crashed'
  | 'destroyed'
  | 'disabled'
  | 'renderer_unavailable'

export interface PluginPanelViewClosedEvent {
  pluginId: string
  openToken: number
  reason: PluginPanelViewCloseReason
}

export interface PluginSettingDefinition {
  type: 'string' | 'number' | 'boolean'
  title?: PluginLocalizedText | string
  enum?: PluginSettingScalar[]
  maxLength?: number
  minimum?: number
  maximum?: number
  format?: 'secret'
  default?: PluginSettingScalar
}

export interface PluginSettingsSchema {
  type: 'object'
  properties: Record<string, PluginSettingDefinition>
}

export interface PluginCommandContribution {
  id: string
  title: PluginLocalizedText
}

export interface PluginSkinContribution {
  id: string
  displayName: PluginLocalizedText
  spritesheet: string
  kind: 'person' | 'animal'
  behaviorManifest?: Record<string, { row: number; frames?: number; frameDurations?: number[] }>
}

export interface PluginManifest {
  id: string
  name: PluginLocalizedText
  version: string
  apiVersion: '1'
  author: string
  entry?: string
  icon?: string
  permissions: {
    network?: {
      hosts: string[]
      userGranted?: boolean
    }
    secrets?: string[]
    schedule?: {
      minIntervalSec: number
    }
    storage?: boolean
    agentStatus?: boolean
  }
  contributes: {
    feed?: boolean
    reaction?: boolean
    settings?: PluginSettingsSchema
    panelView?: {
      entry: string
      title: PluginLocalizedText
      preferredSize?: {
        width: number
        height: number
      }
    }
    commands?: PluginCommandContribution[]
    tray?: { commands: string[] }
    badge?: boolean
    skins?: PluginSkinContribution[]
  }
}

export interface FeedItemInput {
  title: string
  body: string
  link?: string
  icon?: string
  priority?: 'low' | 'normal'
  ttlMs?: number
  dedupeKey?: string
}

export interface PluginFeedItem {
  id: string
  pluginId: string
  targetPetId?: string
  pluginName: PluginLocalizedText
  iconUrl?: string
  title: string
  body: string
  link?: string
  priority: 'low' | 'normal'
  createdAt: number
  expiresAt: number
  /** Renderer hint only; Main still validates the current manifest before opening a panel page. */
  panelViewAvailable?: boolean
}

export interface PetStatusChange {
  petId: string
  name: string
  agentFamily: 'codex' | 'claude-code' | 'opencode' | null
  previousState: string
  visibleState: string
  dnd: boolean
  at: number
}

export interface PluginResourceLimits {
  maxEnabledPlugins: number
  memoryMbPerPlugin: number
  netMaxResponseBytes: number
  netTimeoutSeconds: number
  netRequestsPerMinute: number
  storageBytesPerPlugin: number
  globalFeedPer10Min: number
  scheduleMinIntervalSeconds: number
}

export interface PluginInstancePreferences {
  enabled: boolean
  muted: boolean
  rateLimitPer10Min: number
  targetPetId: string | null
  grantedHosts: string[]
}

export interface PluginPreferences {
  pluginsEnabled: boolean
  developerMode: boolean
  resources: PluginResourceLimits
  plugins: Record<string, PluginInstancePreferences>
}

export interface PluginGlobalPreferencesPatch {
  pluginsEnabled?: boolean
  developerMode?: boolean
  resources?: Partial<PluginResourceLimits>
}

export type PluginErrorCode =
  | 'not_permitted'
  | 'rate_limited'
  | 'invalid_request'
  | 'too_large'
  | 'timeout'
  | 'host_not_allowed'
  | 'disabled'
  | 'queue_full'
  | 'duplicate'
  | 'not_found'
  | 'too_many_enabled'
  | 'host_unavailable'
  | 'too_many_redirects'
  | 'secret_unavailable'
  | 'secret_not_found'
  | 'settings_invalid'
  | 'schedule_invalid'
  | 'agent_status_unavailable'
  | 'denied'

export type PluginRuntimeState = 'installed' | 'enabled' | 'disabled_crashed' | 'incompatible'

export type PluginInstallKind = 'new' | 'update' | 'downgrade' | 'reinstall' | 'incompatible'

export interface PluginInstallPlan {
  token: string
  kind: PluginInstallKind
  pluginId?: string
  name?: PluginLocalizedText
  version?: string
  author?: string
  previousVersion?: string
  permissions?: PluginManifest['permissions']
  contributes?: PluginManifest['contributes']
  addedPermissions: string[]
  requiresReconsent: boolean
}

export interface PluginPanelPlugin {
  id: string
  currentVersion: string
  status: PluginRuntimeState
  installedAt: number
  grantedPermissions: unknown
  manifest: PluginManifest | null
  development: boolean
  preference: PluginInstancePreferences
}

export interface PluginBrokerLogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface PluginBrokerDiagnostic {
  at: number
  code: PluginErrorCode
  method?: string
}

export interface PluginPanelSnapshot {
  preferences: PluginPreferences
  plugins: PluginPanelPlugin[]
}

export interface PluginPanelSettingsSnapshot {
  values: Record<string, PluginSettingScalar>
  secrets: Record<string, boolean>
}

export interface PluginNotificationRecord {
  item: PluginFeedItem
  read: boolean
}

export type PluginPanelResult<T> = { ok: true; value: T } | { ok: false; error: string; cancelled?: boolean }
