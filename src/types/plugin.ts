export type PluginLocalizedText = {
  'zh-TW': string
  'en-US': string
}

export type PluginSettingScalar = string | number | boolean

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

export interface PluginManifest {
  id: string
  name: PluginLocalizedText
  version: string
  apiVersion: '1'
  author: string
  entry: string
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
  pluginName: PluginLocalizedText
  iconUrl?: string
  title: string
  body: string
  link?: string
  priority: 'low' | 'normal'
  createdAt: number
  expiresAt: number
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

export type PluginRuntimeState = 'installed' | 'enabled' | 'disabled_crashed' | 'incompatible'
