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
  PET_STATUS_PROPERTIES,
  type PanelThemeBackgroundState,
  type PanelThemeCatalogEntry,
  type PanelThemeCssProperty,
  type PanelThemeMode,
  type PanelThemePosition,
  type PanelThemeState,
  type PetStatusThemeState,
} from '../types/panel-theme.ts'

// 渲染端、純函式：每個主機建構的名稱與值在進入 style.setProperty 之前
// 都會重新驗證（縱深防禦；主程序已經從封閉文法重新輸出它們），
// 以結構化數字建構漸層，並比對屬性對應表的差異，讓切換時
// 只在同一個 frame 內寫入有變動的部分。

export interface PanelThemeMediaFlags {
  /** forced-colors: active（Windows 高對比）會暫停插件主題。 */
  forcedColors: boolean
  /** prefers-contrast: more 會以主題的文字色加強邊框。 */
  highContrast: boolean
}

const ALLOWED: ReadonlySet<string> = new Set(PANEL_THEME_CSS_PROPERTIES)
const PET_STATUS_ALLOWED: ReadonlySet<string> = new Set(PET_STATUS_PROPERTIES)
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

/** 主機位置列舉對應的 CSS `object-position` / `background-position`。 */
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

/** 名稱在允許清單內，且值符合該屬性的 pattern。 */
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

/** 該模式插槽對應的目錄項目；插槽為內建或不可用時為 null。 */
export function activePanelTheme(state: PanelThemeState | null, mode: PanelThemeMode): PanelThemeCatalogEntry | null {
  const slot = state?.slots[mode]
  if (!state || !slot?.ref || slot.status !== 'active') return null
  const { pluginId, themeId } = slot.ref
  const entry = state.themes.find(theme => theme.ref.pluginId === pluginId && theme.ref.themeId === themeId)
  return entry?.modes[mode] ? entry : null
}

export interface PanelThemePropertyPlan {
  properties: Map<PanelThemeCssProperty, string>
  /** 未通過重新驗證的名稱或值（會記錄，絕不套用）。 */
  rejected: string[]
}

/** `entry` 在 `mode` 下要設定的所有屬性；forced colors 下或沒有 entry 時為空。 */
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

/** 從 `current` 變成 `next` 所需的最少寫入。 */
export function diffPanelThemeProperties(
  current: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): { remove: string[]; set: Array<[string, string]> } {
  const remove = [...current.keys()].filter(name => !next.has(name))
  const set = [...next].filter(([name, value]) => current.get(name) !== value)
  return { remove, set }
}

/** 插槽持有 `ref` 且為啟用中的模式（每個模式唯一「使用中」的主題）。 */
export function activePanelThemeModes(state: PanelThemeState | null, ref: { pluginId: string; themeId: string }): PanelThemeMode[] {
  if (!state) return []
  return (['light', 'dark'] as const).filter(mode => {
    const slot = state.slots[mode]
    return slot.status === 'active' && slot.ref?.pluginId === ref.pluginId && slot.ref.themeId === ref.themeId
  })
}

/**
 * "Panel theme" 設定所在處：擁有啟用中插槽的插件（淺色優先），
 * 否則為第一個提供主題的插件；null 表示沒有可用的主題插件，
 * 此時目標為 Appearance 狀態列。
 */
export function panelThemeSettingsTarget(state: PanelThemeState | null): string | null {
  if (!state) return null
  for (const mode of ['light', 'dark'] as const) {
    const ref = state.slots[mode].ref
    if (ref && state.themes.some(theme => theme.ref.pluginId === ref.pluginId)) return ref.pluginId
  }
  return state.themes[0]?.ref.pluginId ?? null
}

/** 只保留允許清單內、值為主機標準 rgb() 的名稱；其餘一律丟棄。 */
export function petStatusTargetProperties(state: PetStatusThemeState | null, mode: 'light' | 'dark', forcedColors: boolean): Map<string, string> {
  const properties = new Map<string, string>()
  const source = forcedColors ? null : state?.[mode]
  if (!source || typeof source !== 'object') return properties
  for (const [name, value] of Object.entries(source)) {
    if (PET_STATUS_ALLOWED.has(name) && typeof value === 'string' && value.length <= 32 && PANEL_THEME_RGB_PATTERN.test(value)) properties.set(name, value)
  }
  // 全有或全無：只設定一部分會在未經檢查的情況下混用主題色與內建色。
  return properties.size === PET_STATUS_PROPERTIES.length ? properties : new Map()
}
