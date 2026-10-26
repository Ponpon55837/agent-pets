import type { PluginLocalizedText } from './plugin.ts'

export interface PluginCatalogVersion {
  version: string
  apiVersion: string
  url: string
  sha256: string
  size: number
  publishedAt: string
}

export interface PluginCatalogPlugin {
  id: string
  name: PluginLocalizedText
  description: PluginLocalizedText
  author: string
  homepage?: string
  publicKeyFingerprint?: string
  versions: PluginCatalogVersion[]
}

export interface PluginCatalogDocument {
  schemaVersion: 1
  plugins: PluginCatalogPlugin[]
}

export interface PluginCatalogPanelItem {
  plugin: PluginCatalogPlugin
  latestVersion: PluginCatalogVersion
  installedVersion: string | null
  updateAvailable: boolean
}
