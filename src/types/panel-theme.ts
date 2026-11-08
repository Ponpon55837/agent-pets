import type { PluginLocalizedText } from './plugin.ts'

// Shared main <-> panel renderer contract for plugin panel themes. The main
// process builds every value; the renderer re-validates names and values with
// the patterns below before calling style.setProperty (spec §3, §7.3).

export type PanelThemeMode = 'light' | 'dark'
export type PanelThemeFit = 'cover' | 'contain' | 'tile'
export type PanelThemePosition =
  | 'center' | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const PANEL_THEME_MODES: readonly PanelThemeMode[] = ['light', 'dark']
export const PANEL_THEME_FITS: readonly PanelThemeFit[] = ['cover', 'contain', 'tile']
export const PANEL_THEME_POSITIONS: readonly PanelThemePosition[] = [
  'center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
]
export const PANEL_THEME_USER_BLURS = [0, 8, 16, 24] as const
export type PanelThemeUserBlur = typeof PANEL_THEME_USER_BLURS[number]

/** The 29 themable colour properties, in table order (spec §3.2). */
export const PANEL_THEME_COLOR_PROPERTIES = [
  '--organic-bg', '--organic-surface', '--organic-surface-2', '--organic-surface-warm', '--organic-surface-sage',
  '--organic-surface-sage-soft', '--organic-surface-off', '--organic-text', '--organic-text-secondary',
  '--organic-text-muted', '--organic-text-faint', '--organic-accent', '--organic-accent-hover',
  '--organic-accent-text', '--organic-accent-contrast', '--organic-accent-glow', '--organic-accent-track',
  '--organic-accent-on-hover', '--organic-sage', '--organic-sage-deep', '--organic-sage-dark',
  '--organic-sage-track', '--organic-border', '--organic-border-soft', '--organic-border-on-accent',
  '--organic-danger-text', '--organic-success-text', '--organic-warn-text', '--organic-scrim',
] as const
export type PanelThemeColorProperty = typeof PANEL_THEME_COLOR_PROPERTIES[number]

export const PANEL_THEME_FAMILY_PROPERTIES = ['--organic-font-body', '--organic-font-heading'] as const
export const PANEL_THEME_SIZE_PROPERTIES = [
  '--organic-font-label', '--organic-font-body-sm', '--organic-font-body-md', '--organic-font-body-lg',
  '--organic-font-heading-sm', '--organic-font-heading-md', '--organic-font-panel-title',
  '--organic-font-display-sm', '--organic-font-display-md',
] as const
export const PANEL_THEME_RADIUS_PROPERTIES = ['--organic-radius-sm', '--organic-radius-md', '--organic-radius-lg'] as const
export const PANEL_THEME_BACKGROUND_PROPERTY = '--panel-theme-background'

export type PanelThemeSharedProperty =
  | typeof PANEL_THEME_FAMILY_PROPERTIES[number]
  | typeof PANEL_THEME_SIZE_PROPERTIES[number]
  | typeof PANEL_THEME_RADIUS_PROPERTIES[number]

export type PanelThemeCssProperty = PanelThemeColorProperty | PanelThemeSharedProperty | typeof PANEL_THEME_BACKGROUND_PROPERTY

/** The complete allowlist the renderer may ever set on `.status-panel` / `.panel-theme-preview`. */
export const PANEL_THEME_CSS_PROPERTIES: readonly PanelThemeCssProperty[] = Object.freeze([
  ...PANEL_THEME_COLOR_PROPERTIES,
  ...PANEL_THEME_FAMILY_PROPERTIES,
  ...PANEL_THEME_SIZE_PROPERTIES,
  ...PANEL_THEME_RADIUS_PROPERTIES,
  PANEL_THEME_BACKGROUND_PROPERTY,
])

const CHANNEL = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)'
const ALPHA = '(?:0|1|0\\.\\d{0,2}[1-9])'
export const PANEL_THEME_RGB_PATTERN = new RegExp(`^rgb\\(${CHANNEL} ${CHANNEL} ${CHANNEL} \\/ ${ALPHA}\\)$`)
/** One family-list entry as emitted by main: a quoted name (host aliases are `"apt-<16 hex>"`) or a keyword. */
export const PANEL_THEME_FAMILY_ENTRY_PATTERN = /^(?:"[A-Za-z0-9](?:[A-Za-z0-9 -]{0,46}[A-Za-z0-9])?"|serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-rounded|ui-monospace|-apple-system|BlinkMacSystemFont)$/
export const PANEL_THEME_PX_PATTERN = /^(?:\d|[1-9]\d)px$/
export const PANEL_THEME_ASSET_URL_PATTERN = /^agent-pets:\/\/panel-theme\/[0-9a-f]{32}$/
export const PANEL_THEME_FONT_ALIAS_PATTERN = /^apt-[0-9a-f]{16}$/

export interface PanelThemeRef {
  pluginId: string
  themeId: string
}

export type PanelThemeSlotStatus = 'builtin' | 'active' | 'unavailable'
export type PanelThemeUnavailableReason = 'plugin_disabled' | 'plugins_off' | 'theme_removed'

export interface PanelThemeSlotState {
  ref: PanelThemeRef | null
  status: PanelThemeSlotStatus
  reason?: PanelThemeUnavailableReason
}

export interface PanelThemeGradientStop {
  color: string
  at: number
}

export type PanelThemeBackgroundState =
  | { type: 'solid' }
  | { type: 'gradient'; kind: 'linear'; angle: number; stops: PanelThemeGradientStop[] }
  | { type: 'gradient'; kind: 'radial'; position: PanelThemePosition; stops: PanelThemeGradientStop[] }
  | {
      type: 'image'
      url: string
      fit: PanelThemeFit
      position: PanelThemePosition
      opacity: number
      blur: number
      overlay: { color: string; opacity: number }
    }

export interface PanelThemeUserImageCurrent {
  url: string
  fit: PanelThemeFit
  position: PanelThemePosition
  dim: number
  blur: PanelThemeUserBlur
  width: number
  height: number
}

export interface PanelThemeUserImageState {
  minDim: number
  defaultDim: number
  fit: PanelThemeFit
  overlayColor: string
  current?: PanelThemeUserImageCurrent
}

export interface PanelThemeModeState {
  properties: Record<PanelThemeColorProperty, string>
  background: PanelThemeBackgroundState
  userImage?: PanelThemeUserImageState
}

export interface PanelThemeFontState {
  alias: string
  url: string
  weight: 400 | 600 | 700
  style: 'normal' | 'italic'
}

export interface PanelThemeCatalogEntry {
  ref: PanelThemeRef
  pluginName: PluginLocalizedText
  displayName: PluginLocalizedText
  description?: PluginLocalizedText
  shared: {
    properties: Partial<Record<PanelThemeSharedProperty, string>>
    fonts: PanelThemeFontState[]
  }
  modes: Partial<Record<PanelThemeMode, PanelThemeModeState>>
}

export interface PanelThemeState {
  slots: Record<PanelThemeMode, PanelThemeSlotState>
  themes: PanelThemeCatalogEntry[]
}

export interface PanelThemeUserImageOptions {
  fit: PanelThemeFit
  position: PanelThemePosition
  dim: number
  blur: PanelThemeUserBlur
}

/** One persisted user image (`userData/panel-theme.json`, spec §7.1). */
export interface PanelThemeStoredUserImage extends PanelThemeUserImageOptions {
  file: string
  type: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  bytes: number
  importedAt: string
}

export interface PanelThemeStoreData {
  version: 1
  slots: Record<PanelThemeMode, PanelThemeRef | null>
  userImages: Record<string, Record<string, Partial<Record<PanelThemeMode, PanelThemeStoredUserImage>>>>
}

export type PanelThemeIpcResult =
  | { ok: true; value: PanelThemeState }
  | { ok: false; error: import('./ipc').IpcErrorCode; cancelled?: boolean; reason?: 'animated' }

export function isPanelThemeMode(value: unknown): value is PanelThemeMode {
  return value === 'light' || value === 'dark'
}

export function isPanelThemeFit(value: unknown): value is PanelThemeFit {
  return typeof value === 'string' && (PANEL_THEME_FITS as readonly string[]).includes(value)
}

export function isPanelThemePosition(value: unknown): value is PanelThemePosition {
  return typeof value === 'string' && (PANEL_THEME_POSITIONS as readonly string[]).includes(value)
}
