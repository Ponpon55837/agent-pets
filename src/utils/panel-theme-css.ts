import {
  PANEL_THEME_ASSET_URL_PATTERN,
  PANEL_THEME_BACKGROUND_PROPERTY,
  PANEL_THEME_COLOR_PROPERTIES,
  PANEL_THEME_CSS_PROPERTIES,
  PANEL_THEME_FAMILY_ENTRY_PATTERN,
  PANEL_THEME_FAMILY_PROPERTIES,
  PANEL_THEME_FONT_ALIAS_PATTERN,
  PANEL_THEME_PX_PATTERN,
  PANEL_THEME_RGB_PATTERN,
  type PanelThemeBackgroundState,
  type PanelThemeCatalogEntry,
  type PanelThemeCssProperty,
  type PanelThemeMode,
  type PanelThemePosition,
  type PanelThemeState,
} from '../types/panel-theme.ts'

// Renderer-side, pure: re-validates every host-built name and value before it
// may reach style.setProperty (defence in depth; main already re-emitted them
// from closed grammars), builds gradients from structured numbers, and diffs
// property maps so a switch writes only what changed in one frame.

export interface PanelThemeMediaFlags {
  /** forced-colors: active (Windows high contrast) suspends the plugin theme. */
  forcedColors: boolean
  /** prefers-contrast: more strengthens borders from the theme's text colour. */
  highContrast: boolean
}

const ALLOWED: ReadonlySet<string> = new Set(PANEL_THEME_CSS_PROPERTIES)
const COLOR_PROPERTIES: ReadonlySet<string> = new Set(PANEL_THEME_COLOR_PROPERTIES)
const FAMILY_PROPERTIES: ReadonlySet<string> = new Set(PANEL_THEME_FAMILY_PROPERTIES)

const RGB = PANEL_THEME_RGB_PATTERN.source.slice(1, -1)
const STOP = `${RGB} (?:\\d|[1-9]\\d|100)%`
const STOPS = `${STOP}(?:, ${STOP}){1,4}`
const ANGLE = '(?:\\d|[1-9]\\d|[1-2]\\d\\d|3[0-5]\\d)deg'
const POSITION_CSS: Record<PanelThemePosition, string> = {
  center: 'center',
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom',
}
const POSITION_ALTERNATION = Object.values(POSITION_CSS).join('|')
const GRADIENT_PATTERN = new RegExp(`^(?:linear-gradient\\(${ANGLE}, ${STOPS}\\)|radial-gradient\\(ellipse at (?:${POSITION_ALTERNATION}), ${STOPS}\\))$`)

/** CSS `object-position` / `background-position` for a host position enum. */
export function panelThemePositionCss(position: PanelThemePosition): string {
  return POSITION_CSS[position] ?? 'center'
}

export function buildPanelThemeGradient(background: PanelThemeBackgroundState): string | null {
  if (background.type !== 'gradient') return null
  const stops = background.stops.map(stop => `${stop.color} ${stop.at}%`).join(', ')
  const value = background.kind === 'linear'
    ? `linear-gradient(${background.angle}deg, ${stops})`
    : `radial-gradient(ellipse at ${panelThemePositionCss(background.position)}, ${stops})`
  return GRADIENT_PATTERN.test(value) ? value : null
}

/** Allowlisted name and a value matching that property's pattern. */
export function isPanelThemePropertyValue(name: string, value: unknown): value is string {
  if (!ALLOWED.has(name) || typeof value !== 'string' || value.length === 0 || value.length > 512) return false
  if (COLOR_PROPERTIES.has(name)) return PANEL_THEME_RGB_PATTERN.test(value)
  if (FAMILY_PROPERTIES.has(name)) {
    const entries = value.split(', ')
    return entries.length >= 1 && entries.length <= 5 && entries.every(entry => PANEL_THEME_FAMILY_ENTRY_PATTERN.test(entry))
  }
  if (name === PANEL_THEME_BACKGROUND_PROPERTY) return GRADIENT_PATTERN.test(value)
  return PANEL_THEME_PX_PATTERN.test(value)
}

export function isPanelThemeAssetUrl(value: unknown): value is string {
  return typeof value === 'string' && PANEL_THEME_ASSET_URL_PATTERN.test(value)
}

export function isPanelThemeFontAlias(value: unknown): value is string {
  return typeof value === 'string' && PANEL_THEME_FONT_ALIAS_PATTERN.test(value)
}

function withAlpha(color: string, alpha: string): string | null {
  const match = /^rgb\((\d{1,3} \d{1,3} \d{1,3}) \/ [0-9.]+\)$/.exec(color)
  return match ? `rgb(${match[1]} / ${alpha})` : null
}

/** The catalog entry for the mode's slot, or null when the slot is built-in or unavailable. */
export function activePanelTheme(state: PanelThemeState | null, mode: PanelThemeMode): PanelThemeCatalogEntry | null {
  const slot = state?.slots[mode]
  if (!state || !slot?.ref || slot.status !== 'active') return null
  const { pluginId, themeId } = slot.ref
  const entry = state.themes.find(theme => theme.ref.pluginId === pluginId && theme.ref.themeId === themeId)
  return entry?.modes[mode] ? entry : null
}

export interface PanelThemePropertyPlan {
  properties: Map<PanelThemeCssProperty, string>
  /** Names or values that failed re-validation (logged, never applied). */
  rejected: string[]
}

/** Every property to set for `entry` in `mode`; empty under forced colours or with no entry. */
export function panelThemeTargetProperties(
  entry: PanelThemeCatalogEntry | null,
  mode: PanelThemeMode,
  flags: PanelThemeMediaFlags,
): PanelThemePropertyPlan {
  const properties = new Map<PanelThemeCssProperty, string>()
  const rejected: string[] = []
  const modeState = entry?.modes[mode]
  if (!entry || !modeState || flags.forcedColors) return { properties, rejected }
  const candidates: Array<[string, unknown]> = [
    ...Object.entries(entry.shared.properties),
    ...Object.entries(modeState.properties),
  ]
  const gradient = buildPanelThemeGradient(modeState.background)
  if (modeState.background.type === 'gradient') candidates.push([PANEL_THEME_BACKGROUND_PROPERTY, gradient])
  if (flags.highContrast) {
    const text = modeState.properties['--organic-text']
    candidates.push(['--organic-border', withAlpha(text, '0.6')], ['--organic-border-soft', withAlpha(text, '0.4')])
  }
  for (const [name, value] of candidates) {
    if (isPanelThemePropertyValue(name, value)) properties.set(name as PanelThemeCssProperty, value)
    else rejected.push(name.slice(0, 64))
  }
  return { properties, rejected }
}

/** Minimal writes to move from `current` to `next`. */
export function diffPanelThemeProperties(
  current: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): { remove: string[]; set: Array<[string, string]> } {
  const remove = [...current.keys()].filter(name => !next.has(name))
  const set = [...next].filter(([name, value]) => current.get(name) !== value)
  return { remove, set }
}
