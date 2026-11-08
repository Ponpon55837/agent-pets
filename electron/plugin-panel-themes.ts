// Plugin panel themes (`contributes.panelThemes`, spec §2–§7). Pure: no
// Electron or Node imports, so the catalog validator can vendor this file
// (plus panel-theme-color.ts and pet-sprite-validation.ts) unchanged.
//
// Responsibilities: the closed manifest grammar, derivation of optional
// tokens, the per-mode contrast rules, package asset rules, and the catalog
// builder that turns validated themes into host-built CSS values. Every
// violation rejects; nothing is clamped.

import {
  PANEL_THEME_BLACK,
  PANEL_THEME_WHITE,
  compositeColor,
  contrastRatio,
  formatPanelThemeColor,
  mixColor,
  parsePanelThemeColor,
  relativeLuminance,
  withAlpha,
  type PanelThemeRgba,
} from './panel-theme-color.ts'
import { readImageAnimated, readImageOrientation, readImageSize } from './pet-sprite-validation.ts'
import type {
  PluginLocalizedText,
  PluginPanelThemeBackground,
  PluginPanelThemeColorKey,
  PluginPanelThemeColors,
  PluginPanelThemeContribution,
  PluginPanelThemeFit,
  PluginPanelThemeFontFace,
  PluginPanelThemeModeDefinition,
  PluginPanelThemeOverlay,
  PluginPanelThemePosition,
} from '../src/types/plugin.ts'
import type {
  PanelThemeBackgroundState,
  PanelThemeCatalogEntry,
  PanelThemeColorProperty,
  PanelThemeMode,
  PanelThemeModeState,
  PanelThemeRef,
  PanelThemeSharedProperty,
  PanelThemeSlotState,
  PanelThemeState,
  PanelThemeStoreData,
  PanelThemeUnavailableReason,
  PetStatusProperty,
} from '../src/types/panel-theme.ts'

// ── Limits (spec §5.3) ──────────────────────────────────────────────────
export const PANEL_THEME_MAX_THEMES = 8
export const PANEL_THEME_MAX_FACES_PER_THEME = 4
export const PANEL_THEME_MAX_FONT_FILES = 8
export const PANEL_THEME_MAX_IMAGE_FILES = 16
export const PANEL_THEME_MAX_STOPS = 5
export const PANEL_THEME_FONT_MAX_BYTES = 1024 * 1024
export const PANEL_THEME_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const PANEL_THEME_IMAGE_MIN_SIDE = 64
export const PANEL_THEME_IMAGE_MAX_SIDE = 4096
export const PANEL_THEME_IMAGE_MAX_PIXELS = 8_388_608
export const PANEL_THEME_USER_IMAGE_MAX_BYTES = 20 * 1024 * 1024
export const PANEL_THEME_USER_IMAGE_MAX_SIDE = 8192
export const PANEL_THEME_USER_IMAGE_MAX_PIXELS = 16_777_216
export const PANEL_THEME_OVERLAY_FLOOR = 0.5
export const PANEL_THEME_OVERLAY_CEILING = 0.95
export const PANEL_THEME_DIAGNOSTIC_MAX_LENGTH = 200

// ── Token table (spec §3.2) ──────────────────────────────────────────────
type TokenKind = 'required' | 'derived' | 'builtin'
type AlphaClass = 'opaque' | 'translucent' | 'border' | 'scrim'

interface ColorToken {
  key: PluginPanelThemeColorKey
  property: PanelThemeColorProperty
  kind: TokenKind
  alpha: AlphaClass
  light: string
  dark: string
}

export const PANEL_THEME_COLOR_TOKENS: readonly ColorToken[] = Object.freeze([
  { key: 'bg', property: '--organic-bg', kind: 'required', alpha: 'opaque', light: '#f5ead8', dark: '#1f1b16' },
  { key: 'surface', property: '--organic-surface', kind: 'required', alpha: 'opaque', light: '#f9f4ed', dark: '#292420' },
  { key: 'surface2', property: '--organic-surface-2', kind: 'required', alpha: 'opaque', light: '#eee7db', dark: '#342e28' },
  { key: 'surfaceWarm', property: '--organic-surface-warm', kind: 'derived', alpha: 'opaque', light: '#ffe1d0', dark: '#4a3022' },
  { key: 'surfaceSage', property: '--organic-surface-sage', kind: 'derived', alpha: 'opaque', light: '#e1eecc', dark: '#2e3622' },
  { key: 'surfaceSageSoft', property: '--organic-surface-sage-soft', kind: 'derived', alpha: 'opaque', light: '#f0fae1', dark: '#263019' },
  { key: 'surfaceOff', property: '--organic-surface-off', kind: 'derived', alpha: 'opaque', light: '#dcd3c4', dark: '#3f372e' },
  { key: 'text', property: '--organic-text', kind: 'required', alpha: 'opaque', light: '#201e1d', dark: '#f3ede4' },
  { key: 'textSecondary', property: '--organic-text-secondary', kind: 'required', alpha: 'opaque', light: '#645c50', dark: '#cfc5b6' },
  { key: 'textMuted', property: '--organic-text-muted', kind: 'required', alpha: 'opaque', light: '#6b6354', dark: '#b0a592' },
  { key: 'textFaint', property: '--organic-text-faint', kind: 'derived', alpha: 'opaque', light: '#8a8070', dark: '#8d8374' },
  { key: 'accent', property: '--organic-accent', kind: 'required', alpha: 'opaque', light: '#c67139', dark: '#d98652' },
  { key: 'accentHover', property: '--organic-accent-hover', kind: 'derived', alpha: 'opaque', light: '#a85a28', dark: '#e39a6b' },
  { key: 'accentText', property: '--organic-accent-text', kind: 'required', alpha: 'opaque', light: '#8c491a', dark: '#f0b48a' },
  { key: 'onAccent', property: '--organic-accent-contrast', kind: 'required', alpha: 'opaque', light: '#fff2eb', dark: '#201e1d' },
  { key: 'accentGlow', property: '--organic-accent-glow', kind: 'derived', alpha: 'translucent', light: 'rgba(198,113,57,.2)', dark: 'rgba(217,134,82,.28)' },
  { key: 'accentTrack', property: '--organic-accent-track', kind: 'derived', alpha: 'translucent', light: 'rgba(32,30,29,.08)', dark: 'rgba(243,237,228,.1)' },
  { key: 'accentOnHover', property: '--organic-accent-on-hover', kind: 'derived', alpha: 'translucent', light: 'rgba(32,30,29,.05)', dark: 'rgba(243,237,228,.06)' },
  { key: 'sage', property: '--organic-sage', kind: 'builtin', alpha: 'opaque', light: '#7a8a5e', dark: '#9db07b' },
  { key: 'sageDeep', property: '--organic-sage-deep', kind: 'builtin', alpha: 'opaque', light: '#56633f', dark: '#aebf8c' },
  { key: 'sageDark', property: '--organic-sage-dark', kind: 'builtin', alpha: 'opaque', light: '#3d472b', dark: '#c9d6ad' },
  { key: 'sageTrack', property: '--organic-sage-track', kind: 'derived', alpha: 'translucent', light: 'rgba(61,71,43,.16)', dark: 'rgba(201,214,173,.18)' },
  { key: 'border', property: '--organic-border', kind: 'required', alpha: 'border', light: 'rgba(32,30,29,.16)', dark: 'rgba(243,237,228,.18)' },
  { key: 'borderSoft', property: '--organic-border-soft', kind: 'derived', alpha: 'translucent', light: 'rgba(32,30,29,.1)', dark: 'rgba(243,237,228,.1)' },
  { key: 'borderOnAccent', property: '--organic-border-on-accent', kind: 'derived', alpha: 'translucent', light: 'rgba(255,242,235,.55)', dark: 'rgba(32,30,29,.4)' },
  { key: 'dangerText', property: '--organic-danger-text', kind: 'builtin', alpha: 'opaque', light: '#a62f1e', dark: '#ff9a8a' },
  { key: 'successText', property: '--organic-success-text', kind: 'builtin', alpha: 'opaque', light: '#3f5a1c', dark: '#b6d48a' },
  { key: 'warnText', property: '--organic-warn-text', kind: 'builtin', alpha: 'opaque', light: '#7a5200', dark: '#f0c866' },
  { key: 'scrim', property: '--organic-scrim', kind: 'builtin', alpha: 'scrim', light: 'rgba(46,43,37,.42)', dark: 'rgba(0,0,0,.55)' },
])

// ── Pet status pill tokens (spec §3.7) ─────────────────────────────────────
// The one narrow exception to "the pet window is never themed": colours of
// the status pill under the pet. Bubbles, permission/risk UI, state dots,
// completion markers and the sprite stay built-in.
export type PetStatusColorKey = 'background' | 'border' | 'text' | 'textMuted' | 'quotaFill' | 'quotaTrack' | 'quotaWarn'

interface PetStatusToken {
  key: PetStatusColorKey
  property: PetStatusProperty
  required: boolean
  alpha: readonly [number, number]
}

export const PET_STATUS_TOKENS: readonly PetStatusToken[] = Object.freeze([
  { key: 'background', property: '--pet-status-background', required: true, alpha: [0.85, 1] },
  { key: 'border', property: '--pet-status-border', required: false, alpha: [0.08, 1] },
  { key: 'text', property: '--pet-status-text', required: true, alpha: [1, 1] },
  { key: 'textMuted', property: '--pet-status-text-muted', required: false, alpha: [1, 1] },
  { key: 'quotaFill', property: '--pet-status-quota-fill', required: false, alpha: [1, 1] },
  { key: 'quotaTrack', property: '--pet-status-quota-track', required: false, alpha: [0.1, 1] },
  { key: 'quotaWarn', property: '--pet-status-quota-warn', required: false, alpha: [1, 1] },
])
const PET_STATUS_KEYS: readonly string[] = PET_STATUS_TOKENS.map(token => token.key)
/** Built-in low-quota colour (`--organic-quota-warning`), used when quotaWarn is omitted. */
const BUILTIN_QUOTA_WARNING = '#e3b64f'

const TOKEN_BY_KEY: ReadonlyMap<string, ColorToken> = new Map(PANEL_THEME_COLOR_TOKENS.map(token => [token.key, token]))
const ALPHA_RANGES: Record<AlphaClass, readonly [number, number]> = {
  opaque: [1, 1],
  translucent: [0.02, 0.95],
  border: [0.08, 1],
  scrim: [0.3, 0.9],
}

const BASE_FONT_SIZES: ReadonlyArray<readonly [PanelThemeSharedProperty, number]> = [
  ['--organic-font-label', 12], ['--organic-font-body-sm', 12], ['--organic-font-body-md', 13],
  ['--organic-font-body-lg', 15], ['--organic-font-heading-sm', 15], ['--organic-font-heading-md', 18],
  ['--organic-font-panel-title', 18], ['--organic-font-display-sm', 22], ['--organic-font-display-md', 22],
]
const FONT_FLOOR_PX = 11
const DEFAULT_BODY_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const DEFAULT_HEADING_FAMILY = '"Lining Digits", "Georgia", "Times New Roman", serif'
const DEFAULT_RADII = { radiusSm: 8, radiusMd: 16, radiusLg: 28 } as const
const RADIUS_MAX = { radiusSm: 16, radiusMd: 24, radiusLg: 32 } as const

const THEME_ID = /^[a-z0-9-]{1,32}$/
const FONT_ID = /^[a-z0-9-]{1,32}$/
const LOCAL_FAMILY = /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,46}[A-Za-z0-9])?$/
const FONT_REFERENCE = /^@([a-z0-9-]{1,32})$/
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-rounded', 'ui-monospace',
])
const FITS: ReadonlySet<string> = new Set(['cover', 'contain', 'tile'])
const POSITIONS: ReadonlySet<string> = new Set([
  'center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
])
const MODES: readonly PanelThemeMode[] = ['light', 'dark']

// ── Diagnostics ──────────────────────────────────────────────────────────
// Only host-known names, validated ids, indices and numbers are ever put in a
// diagnostic, so it is safe to show (developer mode only) without escaping.

export class PanelThemeValidationError extends Error {
  readonly diagnostic: string

  constructor(diagnostic: string) {
    const bounded = diagnostic.length > PANEL_THEME_DIAGNOSTIC_MAX_LENGTH
      ? `${diagnostic.slice(0, PANEL_THEME_DIAGNOSTIC_MAX_LENGTH - 1)}…`
      : diagnostic
    super(bounded)
    this.diagnostic = bounded
  }
}

function fail(path: string, problem: string): never {
  throw new PanelThemeValidationError(`${path}: ${problem}`)
}

function ratioText(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2)
}

// ── Small parsers ────────────────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(path, 'unknown key')
  }
}

function normalizePlainText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0 && text.length <= maxLength ? text : null
}

function parseLocalized(value: unknown, maxLength: number, path: string): PluginLocalizedText {
  if (!isRecord(value)) fail(path, 'must be { "zh-TW", "en-US" }')
  assertKeys(value, ['zh-TW', 'en-US'], path)
  const zhTW = normalizePlainText(value['zh-TW'], maxLength)
  const enUS = normalizePlainText(value['en-US'], maxLength)
  if (!zhTW || !enUS) fail(path, `each locale needs 1-${maxLength} characters`)
  return { 'zh-TW': zhTW, 'en-US': enUS }
}

/** Same rules as plugin-manifest.ts normalizeRelativePath. */
export function normalizePanelThemeAssetPath(value: unknown, extensions: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null
  const normalized = value.normalize('NFC')
  if (normalized.startsWith('/') || normalized.includes('\\') || normalized.includes('..') || normalized.includes(':')
    || /[\u0000-\u001f\u007f<>"|?*]/.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || /[. ]$/.test(segment))) return null
  if (segments.some(segment => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment))) return null
  const suffix = `.${normalized.split('.').at(-1)?.toLowerCase() ?? ''}`
  return extensions.includes(suffix) ? normalized : null
}

function integerIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `must be an integer ${min}-${max}`)
  }
  return value
}

function numberIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `must be a number ${min}-${max}`)
  }
  return value
}

function hasAtMostTwoDecimals(value: number): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(String(value))
}

function enumOf<T extends string>(value: unknown, allowed: ReadonlySet<string>, fallback: T, path: string): T {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.has(value)) fail(path, 'is not an allowed value')
  return value as T
}

function colorAt(value: unknown, path: string): PanelThemeRgba {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) {
    fail(path, parsed.error === 'out_of_gamut' ? 'colour is outside sRGB' : parsed.error === 'out_of_range' ? 'colour value out of range' : 'not an allowed colour')
  }
  return parsed.color
}

function opaqueColorAt(value: unknown, path: string): PanelThemeRgba {
  const color = colorAt(value, path)
  if (color.a !== 1) fail(path, 'must be opaque')
  return color
}

// ── Resolved model ───────────────────────────────────────────────────────
export type PanelThemeFamilyEntry =
  | { kind: 'font'; id: string }
  | { kind: 'local'; name: string }
  | { kind: 'generic'; name: string }

export type ResolvedPanelThemeBackground =
  | { type: 'solid' }
  | { type: 'gradient'; kind: 'linear'; angle: number; stops: Array<{ color: PanelThemeRgba; at: number }> }
  | { type: 'gradient'; kind: 'radial'; position: PluginPanelThemePosition; stops: Array<{ color: PanelThemeRgba; at: number }> }
  | {
      type: 'image'
      src: string
      fit: PluginPanelThemeFit
      position: PluginPanelThemePosition
      opacity: number
      blur: number
      overlay: { color: PanelThemeRgba; opacity: number }
    }

export interface ResolvedPanelThemeMode {
  colors: Record<PluginPanelThemeColorKey, PanelThemeRgba>
  petStatus?: Record<PetStatusColorKey, PanelThemeRgba>
  background: ResolvedPanelThemeBackground
  userImage?: { fit: PluginPanelThemeFit; overlayColor: PanelThemeRgba; defaultDim: number; minDim: number }
}

export interface ResolvedPanelTheme {
  id: string
  displayName: PluginLocalizedText
  description?: PluginLocalizedText
  fonts: PluginPanelThemeFontFace[]
  typography: { body: PanelThemeFamilyEntry[] | null; heading: PanelThemeFamilyEntry[] | null; scale: number }
  shape: { radiusSm: number; radiusMd: number; radiusLg: number }
  modes: Partial<Record<PanelThemeMode, ResolvedPanelThemeMode>>
}

export interface PanelThemeParseResult {
  contributions: PluginPanelThemeContribution[]
  themes: ResolvedPanelTheme[]
}

// ── Typography / fonts / shape ───────────────────────────────────────────
function parseFonts(value: unknown, path: string): PluginPanelThemeFontFace[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > PANEL_THEME_MAX_FACES_PER_THEME) {
    fail(path, `must be an array of at most ${PANEL_THEME_MAX_FACES_PER_THEME} faces`)
  }
  const faces: PluginPanelThemeFontFace[] = []
  const seen = new Set<string>()
  value.forEach((raw, index) => {
    const facePath = `${path}[${index}]`
    if (!isRecord(raw)) fail(facePath, 'must be an object')
    assertKeys(raw, ['id', 'src', 'weight', 'style'], facePath)
    if (typeof raw.id !== 'string' || !FONT_ID.test(raw.id)) fail(`${facePath}.id`, 'must match ^[a-z0-9-]{1,32}$')
    const src = normalizePanelThemeAssetPath(raw.src, ['.woff2'])
    if (!src) fail(`${facePath}.src`, 'must be a safe relative .woff2 path')
    const weight = raw.weight === undefined ? 400 : raw.weight
    if (weight !== 400 && weight !== 600 && weight !== 700) fail(`${facePath}.weight`, 'must be 400, 600 or 700')
    const style = raw.style === undefined ? 'normal' : raw.style
    if (style !== 'normal' && style !== 'italic') fail(`${facePath}.style`, 'must be normal or italic')
    const key = `${raw.id}\u0000${weight}\u0000${style}`
    if (seen.has(key)) fail(facePath, 'duplicate id, weight and style')
    seen.add(key)
    faces.push({ id: raw.id, src, weight, style })
  })
  return faces
}

function parseFamilyList(value: unknown, fontIds: ReadonlySet<string>, path: string): { raw: string[]; entries: PanelThemeFamilyEntry[] } | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) fail(path, 'must list 1-5 families')
  const entries: PanelThemeFamilyEntry[] = []
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`
    if (typeof entry !== 'string') fail(entryPath, 'must be a string')
    const reference = FONT_REFERENCE.exec(entry)
    if (reference) {
      if (!fontIds.has(reference[1]!)) fail(entryPath, 'names no face in this theme\'s fonts')
      entries.push({ kind: 'font', id: reference[1]! })
    } else if (GENERIC_FAMILIES.has(entry)) {
      entries.push({ kind: 'generic', name: entry })
    } else if (LOCAL_FAMILY.test(entry)) {
      entries.push({ kind: 'local', name: entry })
    } else {
      fail(entryPath, 'is not an allowed family name')
    }
  })
  if (entries.at(-1)?.kind !== 'generic') fail(path, 'last entry must be a generic family')
  return { raw: [...value as string[]], entries }
}

function parseTypography(value: unknown, fontIds: ReadonlySet<string>, path: string) {
  if (value === undefined) return { contribution: { scale: 1 }, body: null, heading: null, scale: 1 }
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, ['body', 'heading', 'scale'], path)
  const body = parseFamilyList(value.body, fontIds, `${path}.body`)
  const heading = parseFamilyList(value.heading, fontIds, `${path}.heading`)
  let scale = 1
  if (value.scale !== undefined) {
    scale = numberIn(value.scale, 0.92, 1.15, `${path}.scale`)
    if (!hasAtMostTwoDecimals(scale)) fail(`${path}.scale`, 'must have at most 2 decimals')
  }
  return {
    contribution: { ...(body ? { body: body.raw } : {}), ...(heading ? { heading: heading.raw } : {}), scale },
    body: body?.entries ?? null,
    heading: heading?.entries ?? null,
    scale,
  }
}

function parseShape(value: unknown, path: string): { radiusSm: number; radiusMd: number; radiusLg: number } {
  if (value === undefined) return { ...DEFAULT_RADII }
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, ['radiusSm', 'radiusMd', 'radiusLg'], path)
  const shape = { ...DEFAULT_RADII } as { radiusSm: number; radiusMd: number; radiusLg: number }
  for (const key of ['radiusSm', 'radiusMd', 'radiusLg'] as const) {
    if (value[key] !== undefined) shape[key] = integerIn(value[key], 0, RADIUS_MAX[key], `${path}.${key}`)
  }
  if (shape.radiusSm > shape.radiusMd || shape.radiusMd > shape.radiusLg) {
    fail(path, 'radii must satisfy radiusSm <= radiusMd <= radiusLg')
  }
  return shape
}

// ── Colours, derivation and contrast ─────────────────────────────────────
function builtinColor(token: ColorToken, mode: PanelThemeMode): PanelThemeRgba {
  const parsed = parsePanelThemeColor(mode === 'light' ? token.light : token.dark)
  if (!parsed.ok) throw new TypeError(`built-in ${token.key} is not a valid colour`)
  return parsed.color
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Derives the "D" tokens (spec §3.5) and fills "B" tokens with the built-in value for the mode. */
export function derivePanelThemeColors(
  declared: Partial<Record<PluginPanelThemeColorKey, PanelThemeRgba>>,
  mode: PanelThemeMode,
): Record<PluginPanelThemeColorKey, PanelThemeRgba> {
  const colors = { ...declared } as Record<PluginPanelThemeColorKey, PanelThemeRgba>
  for (const token of PANEL_THEME_COLOR_TOKENS) {
    if (token.kind === 'builtin' && !colors[token.key]) colors[token.key] = builtinColor(token, mode)
  }
  const derive = (key: PluginPanelThemeColorKey, compute: () => PanelThemeRgba) => {
    if (!colors[key]) colors[key] = compute()
  }
  derive('surfaceWarm', () => mixColor(colors.surface, colors.accent, 0.18))
  derive('surfaceSage', () => mixColor(colors.surface, colors.sage, 0.18))
  derive('surfaceSageSoft', () => mixColor(colors.surface, colors.sage, 0.08))
  derive('surfaceOff', () => mixColor(colors.surface2, colors.text, 0.12))
  derive('textFaint', () => ({ ...colors.textMuted }))
  derive('accentHover', () => deriveAccentHover(colors.accent, colors.text, colors.onAccent))
  derive('accentGlow', () => withAlpha(colors.accent, 0.22))
  derive('accentTrack', () => withAlpha(colors.text, 0.08))
  derive('accentOnHover', () => withAlpha(colors.text, 0.05))
  derive('sageTrack', () => withAlpha(colors.sageDark, 0.16))
  derive('borderSoft', () => withAlpha(colors.border, round3(colors.border.a * 0.625)))
  derive('borderOnAccent', () => withAlpha(colors.onAccent, 0.55))
  return colors
}

/**
 * accentHover = mix(accent, text, t) for the first t in 0.20, 0.25, ... 0.60
 * that keeps onAccent >= 4.5:1 on it; 0.20 when none does (the theme is then
 * rejected by the onAccent/accentHover pair). Deterministic, and it moves
 * toward the text colour, so it darkens in light mode and lightens in dark.
 */
export function deriveAccentHover(accent: PanelThemeRgba, text: PanelThemeRgba, onAccent: PanelThemeRgba): PanelThemeRgba {
  for (let step = 20; step <= 60; step += 5) {
    const candidate = mixColor(accent, text, step / 100)
    if (contrastRatio(onAccent, candidate) >= 4.5) return candidate
  }
  return mixColor(accent, text, 0.2)
}

type ColorSet = Record<PluginPanelThemeColorKey, PanelThemeRgba>
interface Backdrop { name: string; color: PanelThemeRgba }
type Pair = readonly [PluginPanelThemeColorKey, number]

const BACKDROP_PAIRS: readonly Pair[] = [['text', 4.5], ['textSecondary', 4.5], ['textMuted', 4.5], ['accentText', 4.5], ['accent', 3]]
const SURFACE_PAIRS: ReadonlyArray<readonly [PluginPanelThemeColorKey, PluginPanelThemeColorKey, number]> = [
  ...(['surface', 'surface2'] as const).flatMap(surface => (
    (['text', 'textSecondary', 'textMuted', 'dangerText', 'successText', 'warnText'] as const)
      .map(fg => [fg, surface, 4.5] as const)
  )),
  ['accentText', 'surface', 4.5],
  ['accentText', 'surfaceWarm', 4.5],
  ['text', 'surfaceWarm', 4.5],
  ['text', 'surfaceSage', 4.5],
  ['textFaint', 'surface', 3],
  ['accent', 'surface', 3],
  ['onAccent', 'accentHover', 4.5],
  ['onAccent', 'accent', 3],
]

interface ContrastFailure { foreground: string; background: string; ratio: number; minimum: number }

function firstBackdropFailure(colors: ColorSet, backdrops: readonly Backdrop[]): ContrastFailure | null {
  for (const backdrop of backdrops) {
    for (const [key, minimum] of BACKDROP_PAIRS) {
      const ratio = contrastRatio(colors[key], backdrop.color)
      if (!(ratio >= minimum)) return { foreground: key, background: backdrop.name, ratio, minimum }
    }
  }
  return null
}

function firstSurfaceFailure(colors: ColorSet): ContrastFailure | null {
  for (const [foreground, background, minimum] of SURFACE_PAIRS) {
    const ratio = contrastRatio(colors[foreground], colors[background])
    if (!(ratio >= minimum)) return { foreground, background, ratio, minimum }
  }
  return null
}

function imageBackdrops(colors: ColorSet, overlay: PanelThemeRgba, overlayOpacity: number, imageOpacity: number, label: string): Backdrop[] {
  return [PANEL_THEME_BLACK, PANEL_THEME_WHITE].map((extreme, index) => {
    const painted = compositeColor(withAlphaUnrounded(extreme, imageOpacity), colors.bg)
    return {
      name: label === 'overlay' ? `overlay over a ${index === 0 ? 'black' : 'white'} pixel` : `${index === 0 ? 'black' : 'white'} image pixel`,
      color: compositeColor(withAlphaUnrounded(overlay, overlayOpacity), painted),
    }
  })
}

function withAlphaUnrounded(color: PanelThemeRgba, alpha: number): PanelThemeRgba {
  return { r: color.r, g: color.g, b: color.b, a: alpha }
}

/**
 * Smallest overlay opacity on the 0.01 grid in [0.50, 0.95] from which every
 * larger step also keeps every backdrop pair readable (worst-case black and
 * white image pixels). Null when no such opacity exists. Suffix-closed so any
 * dim the user later picks at or above the minimum is guaranteed to pass.
 */
export function minimumPanelThemeOverlay(colors: ColorSet, overlay: PanelThemeRgba, imageOpacity: number): number | null {
  let minimum: number | null = null
  for (let step = 95; step >= 50; step -= 1) {
    const opacity = step / 100
    if (firstBackdropFailure(colors, imageBackdrops(colors, overlay, opacity, imageOpacity, 'overlay'))) break
    minimum = opacity
  }
  return minimum
}

/** Validates a declared overlay and returns the minimum; the diagnostic names the failing pair. */
function checkOverlay(colors: ColorSet, overlay: { color: PanelThemeRgba; opacity: number }, imageOpacity: number, path: string, label: string): number {
  const minimum = minimumPanelThemeOverlay(colors, overlay.color, imageOpacity)
  const probe = minimum === null ? PANEL_THEME_OVERLAY_CEILING : overlay.opacity
  const failure = firstBackdropFailure(colors, imageBackdrops(colors, overlay.color, probe, imageOpacity, label))
  if (minimum === null) {
    const detail = failure ? `${failure.foreground} ${ratioText(failure.ratio)}:1 < ${failure.minimum}:1 on ${failure.background}` : 'text unreadable'
    fail(`${path}.opacity`, `no overlay up to 0.95 passes (${detail} at 0.95); change the overlay colour or text colours`)
  }
  if (overlay.opacity < minimum) {
    const detail = failure ? `; ${failure.foreground} ${ratioText(failure.ratio)}:1 < ${failure.minimum}:1 on ${failure.background}` : ''
    fail(`${path}.opacity`, `${overlay.opacity} < minimum ${minimum.toFixed(2)}${detail}`)
  }
  return minimum
}

function parseOverlay(value: unknown, path: string): { color: PanelThemeRgba; opacity: number } {
  if (!isRecord(value)) fail(path, 'must be { color, opacity }')
  assertKeys(value, ['color', 'opacity'], path)
  const color = opaqueColorAt(value.color, `${path}.color`)
  const opacity = numberIn(value.opacity, PANEL_THEME_OVERLAY_FLOOR, PANEL_THEME_OVERLAY_CEILING, `${path}.opacity`)
  return { color, opacity }
}

function parseStops(value: unknown, path: string): Array<{ color: PanelThemeRgba; at: number }> {
  if (!Array.isArray(value) || value.length < 2 || value.length > PANEL_THEME_MAX_STOPS) fail(path, 'needs 2-5 stops')
  let previous = -1
  return value.map((raw, index) => {
    const stopPath = `${path}[${index}]`
    if (!isRecord(raw)) fail(stopPath, 'must be { color, at }')
    assertKeys(raw, ['color', 'at'], stopPath)
    const color = opaqueColorAt(raw.color, `${stopPath}.color`)
    const at = integerIn(raw.at, 0, 100, `${stopPath}.at`)
    if (at < previous) fail(`${stopPath}.at`, 'stops must not decrease')
    previous = at
    return { color, at }
  })
}

function parseBackground(value: unknown, path: string): ResolvedPanelThemeBackground {
  if (value === undefined) return { type: 'solid' }
  if (!isRecord(value)) fail(path, 'must be an object')
  if (value.type === 'solid') {
    assertKeys(value, ['type'], path)
    return { type: 'solid' }
  }
  if (value.type === 'gradient') {
    if (value.kind === 'linear') {
      assertKeys(value, ['type', 'kind', 'angle', 'stops'], path)
      const angle = value.angle === undefined ? 180 : integerIn(value.angle, 0, 359, `${path}.angle`)
      return { type: 'gradient', kind: 'linear', angle, stops: parseStops(value.stops, `${path}.stops`) }
    }
    if (value.kind === 'radial') {
      assertKeys(value, ['type', 'kind', 'position', 'stops'], path)
      const position = enumOf<PluginPanelThemePosition>(value.position, POSITIONS, 'center', `${path}.position`)
      return { type: 'gradient', kind: 'radial', position, stops: parseStops(value.stops, `${path}.stops`) }
    }
    fail(`${path}.kind`, 'must be linear or radial')
  }
  if (value.type === 'image') {
    assertKeys(value, ['type', 'src', 'fit', 'position', 'opacity', 'blur', 'overlay'], path)
    const src = normalizePanelThemeAssetPath(value.src, ['.png', '.webp'])
    if (!src) fail(`${path}.src`, 'must be a safe relative .png or .webp path')
    return {
      type: 'image',
      src,
      fit: enumOf<PluginPanelThemeFit>(value.fit, FITS, 'cover', `${path}.fit`),
      position: enumOf<PluginPanelThemePosition>(value.position, POSITIONS, 'center', `${path}.position`),
      opacity: value.opacity === undefined ? 1 : numberIn(value.opacity, 0.2, 1, `${path}.opacity`),
      blur: value.blur === undefined ? 0 : integerIn(value.blur, 0, 24, `${path}.blur`),
      overlay: parseOverlay(value.overlay, `${path}.overlay`),
    }
  }
  fail(`${path}.type`, 'must be solid, gradient or image')
}

function gradientBackdrops(stops: ReadonlyArray<{ color: PanelThemeRgba }>): Backdrop[] {
  const backdrops: Backdrop[] = stops.map((stop, index) => ({ name: `gradient stop ${index}`, color: stop.color }))
  for (let index = 0; index + 1 < stops.length; index += 1) {
    for (const t of [0.25, 0.5, 0.75]) {
      backdrops.push({ name: `gradient between stops ${index} and ${index + 1}`, color: mixColor(stops[index]!.color, stops[index + 1]!.color, t) })
    }
  }
  return backdrops
}

function failContrast(path: string, failure: ContrastFailure): never {
  fail(`${path}.colors.${failure.foreground}`, `${ratioText(failure.ratio)}:1 < ${failure.minimum}:1 on ${failure.background}`)
}

function parseMode(value: unknown, mode: PanelThemeMode, path: string): { contribution: PluginPanelThemeModeDefinition; resolved: ResolvedPanelThemeMode } {
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, ['colors', 'background', 'userImage', 'petStatus'], path)
  if (!isRecord(value.colors)) fail(`${path}.colors`, 'is required')
  const declared: Partial<Record<PluginPanelThemeColorKey, PanelThemeRgba>> = {}
  for (const [key, raw] of Object.entries(value.colors)) {
    const token = TOKEN_BY_KEY.get(key)
    if (!token) fail(`${path}.colors`, 'unknown key')
    declared[token.key] = colorAt(raw, `${path}.colors.${token.key}`)
  }
  for (const token of PANEL_THEME_COLOR_TOKENS) {
    if (token.kind === 'required' && !declared[token.key]) fail(`${path}.colors.${token.key}`, 'is required')
  }
  const colors = derivePanelThemeColors(declared, mode)
  for (const token of PANEL_THEME_COLOR_TOKENS) {
    const [min, max] = ALPHA_RANGES[token.alpha]
    const alpha = colors[token.key].a
    if (alpha < min || alpha > max) {
      fail(`${path}.colors.${token.key}`, token.alpha === 'opaque' ? 'must be opaque' : `alpha must be ${min}-${max}`)
    }
  }

  const bgLuminance = relativeLuminance(colors.bg)
  const textLuminance = relativeLuminance(colors.text)
  if (mode === 'light' && !(textLuminance < bgLuminance && bgLuminance >= 0.45)) {
    fail(`${path}.colors.bg`, 'light mode needs a light bg (luminance >= 0.45) and darker text')
  }
  if (mode === 'dark' && !(textLuminance > bgLuminance && bgLuminance <= 0.12)) {
    fail(`${path}.colors.bg`, 'dark mode needs a dark bg (luminance <= 0.12) and lighter text')
  }

  const background = parseBackground(value.background, `${path}.background`)
  const backdrops: Backdrop[] = [{ name: 'bg', color: colors.bg }]
  if (background.type === 'gradient') backdrops.push(...gradientBackdrops(background.stops))
  const surfaceFailure = firstSurfaceFailure(colors)
  if (surfaceFailure) failContrast(path, surfaceFailure)
  const backdropFailure = firstBackdropFailure(colors, backdrops)
  if (backdropFailure) failContrast(path, backdropFailure)
  // Image backdrops: checked through the minimum overlay so the diagnostic is actionable.
  if (background.type === 'image') {
    checkOverlay(colors, background.overlay, background.opacity, `${path}.background.overlay`, 'a black/white image pixel')
  }

  let userImage: ResolvedPanelThemeMode['userImage']
  let userImageContribution: PluginPanelThemeModeDefinition['userImage']
  if (value.userImage !== undefined) {
    const userPath = `${path}.userImage`
    if (!isRecord(value.userImage)) fail(userPath, 'must be an object')
    assertKeys(value.userImage, ['allowed', 'fit', 'overlay'], userPath)
    if (value.userImage.allowed !== true) fail(`${userPath}.allowed`, 'must be true')
    const fit = enumOf<PluginPanelThemeFit>(value.userImage.fit, FITS, 'cover', `${userPath}.fit`)
    const overlay = parseOverlay(value.userImage.overlay, `${userPath}.overlay`)
    const minimum = checkOverlay(colors, overlay, 1, `${userPath}.overlay`, 'a black/white image pixel')
    userImage = { fit, overlayColor: overlay.color, defaultDim: overlay.opacity, minDim: minimum }
    userImageContribution = { allowed: true, fit, overlay: { color: formatPanelThemeColor(overlay.color), opacity: overlay.opacity } }
  }

  let petStatus: Record<PetStatusColorKey, PanelThemeRgba> | undefined
  let petStatusContribution: Partial<Record<PetStatusColorKey, string>> | undefined
  if (value.petStatus !== undefined) {
    const parsed = parsePetStatus(value.petStatus, colors, `${path}.petStatus`)
    petStatus = parsed.resolved
    petStatusContribution = parsed.contribution
  }

  const contributionColors: PluginPanelThemeColors = {}
  for (const [key, color] of Object.entries(declared)) contributionColors[key as PluginPanelThemeColorKey] = formatPanelThemeColor(color)
  return {
    contribution: {
      colors: contributionColors,
      background: contributionBackground(background),
      ...(userImageContribution ? { userImage: userImageContribution } : {}),
      ...(petStatusContribution ? { petStatus: petStatusContribution } : {}),
    },
    resolved: { colors, background, ...(userImage ? { userImage } : {}), ...(petStatus ? { petStatus } : {}) },
  }
}

/**
 * Derives omitted pill tokens from the required background and text, then
 * checks contrast against the pill composited over a worst-case black and a
 * worst-case white desktop pixel (the pill floats over arbitrary content).
 */
export function derivePetStatusColors(
  declared: Partial<Record<PetStatusColorKey, PanelThemeRgba>> & { background: PanelThemeRgba; text: PanelThemeRgba },
  modeColors: Pick<ColorSet, 'accent'>,
): Record<PetStatusColorKey, PanelThemeRgba> {
  const opaqueBackground = withAlpha(declared.background, 1)
  const warning = parsePanelThemeColor(BUILTIN_QUOTA_WARNING)
  const quotaTrack = declared.quotaTrack ?? withAlpha(declared.text, 0.18)
  return {
    background: declared.background,
    text: declared.text,
    textMuted: declared.textMuted ?? mixColor(declared.text, opaqueBackground, 0.25),
    border: declared.border ?? withAlpha(declared.text, 0.18),
    quotaTrack,
    quotaFill: declared.quotaFill ?? withAlpha(modeColors.accent, 1),
    quotaWarn: declared.quotaWarn ?? deriveQuotaWarn(warning.ok ? warning.color : PANEL_THEME_WHITE, declared, quotaTrack),
  }
}

/**
 * Omitted quotaWarn: the built-in low-quota amber, moved toward the pill text
 * in 0.10 steps (0.00 … 0.60) until it reaches 3:1 on the pill and on the
 * quota track, each over both a black and a white desktop; the last step when
 * none does (the theme is then rejected).
 */
function deriveQuotaWarn(amber: PanelThemeRgba, declared: { background: PanelThemeRgba; text: PanelThemeRgba }, track: PanelThemeRgba): PanelThemeRgba {
  const pill = petStatusBackdrops(declared.background)
  const backdrops = [...pill, ...pill.map(backdrop => ({ name: backdrop.name, color: compositeColor(track, backdrop.color) }))]
  let candidate = amber
  for (let step = 0; step <= 6; step += 1) {
    candidate = mixColor(amber, declared.text, step / 10)
    if (backdrops.every(backdrop => contrastRatio(candidate, backdrop.color) >= 3)) return candidate
  }
  return candidate
}

function petStatusBackdrops(background: PanelThemeRgba): Backdrop[] {
  return [PANEL_THEME_BLACK, PANEL_THEME_WHITE].map((desktop, index) => ({
    name: `pill over a ${index === 0 ? 'black' : 'white'} desktop`,
    color: compositeColor(background, desktop),
  }))
}

function parsePetStatus(value: unknown, modeColors: ColorSet, path: string) {
  if (!isRecord(value)) fail(path, 'must be an object')
  assertKeys(value, PET_STATUS_KEYS, path)
  const declared: Partial<Record<PetStatusColorKey, PanelThemeRgba>> = {}
  for (const token of PET_STATUS_TOKENS) {
    if (value[token.key] === undefined) {
      if (token.required) fail(`${path}.${token.key}`, 'is required')
      continue
    }
    declared[token.key] = colorAt(value[token.key], `${path}.${token.key}`)
  }
  const resolved = derivePetStatusColors(declared as Parameters<typeof derivePetStatusColors>[0], modeColors)
  for (const token of PET_STATUS_TOKENS) {
    const [min, max] = token.alpha
    const alpha = resolved[token.key].a
    if (alpha < min || alpha > max) fail(`${path}.${token.key}`, min === 1 ? 'must be opaque' : `alpha must be ${min}-${max}`)
  }
  for (const backdrop of petStatusBackdrops(resolved.background)) {
    const track = compositeColor(resolved.quotaTrack, backdrop.color)
    const pairs: Array<[PetStatusColorKey, PanelThemeRgba, string, number]> = [
      ['text', backdrop.color, backdrop.name, 4.5],
      ['textMuted', backdrop.color, backdrop.name, 4.5],
      ['quotaFill', backdrop.color, backdrop.name, 3],
      ['quotaFill', track, `quotaTrack on the ${backdrop.name}`, 3],
      ['quotaWarn', backdrop.color, backdrop.name, 3],
      ['quotaWarn', track, `quotaTrack on the ${backdrop.name}`, 3],
    ]
    for (const [key, background, name, minimum] of pairs) {
      const ratio = contrastRatio(resolved[key], background)
      if (!(ratio >= minimum)) fail(`${path}.${key}`, `${ratioText(ratio)}:1 < ${minimum}:1 on ${name}`)
    }
  }
  const contribution: Partial<Record<PetStatusColorKey, string>> = {}
  for (const [key, color] of Object.entries(declared)) contribution[key as PetStatusColorKey] = formatPanelThemeColor(color)
  return { resolved, contribution }
}

function contributionBackground(background: ResolvedPanelThemeBackground): PluginPanelThemeBackground {
  if (background.type === 'solid') return { type: 'solid' }
  if (background.type === 'image') {
    return { ...background, overlay: { color: formatPanelThemeColor(background.overlay.color), opacity: background.overlay.opacity } }
  }
  const stops = background.stops.map(stop => ({ color: formatPanelThemeColor(stop.color), at: stop.at }))
  return background.kind === 'linear'
    ? { type: 'gradient', kind: 'linear', angle: background.angle, stops }
    : { type: 'gradient', kind: 'radial', position: background.position, stops }
}

function parseTheme(value: unknown, index: number): { contribution: PluginPanelThemeContribution; resolved: ResolvedPanelTheme } {
  const indexPath = `panelThemes[${index}]`
  if (!isRecord(value)) fail(indexPath, 'must be an object')
  if (typeof value.id !== 'string' || !THEME_ID.test(value.id)) fail(`${indexPath}.id`, 'must match ^[a-z0-9-]{1,32}$')
  const path = value.id
  assertKeys(value, ['id', 'displayName', 'description', 'fonts', 'typography', 'shape', 'modes'], path)
  const displayName = parseLocalized(value.displayName, 48, `${path}.displayName`)
  const description = value.description === undefined ? undefined : parseLocalized(value.description, 120, `${path}.description`)
  const fonts = parseFonts(value.fonts, `${path}.fonts`)
  const typography = parseTypography(value.typography, new Set(fonts.map(face => face.id)), `${path}.typography`)
  const shape = parseShape(value.shape, `${path}.shape`)
  if (!isRecord(value.modes)) fail(`${path}.modes`, 'needs light and/or dark')
  assertKeys(value.modes, MODES, `${path}.modes`)
  const contributionModes: PluginPanelThemeContribution['modes'] = {}
  const resolvedModes: ResolvedPanelTheme['modes'] = {}
  for (const mode of MODES) {
    if (value.modes[mode] === undefined) continue
    const parsed = parseMode(value.modes[mode], mode, `${path}.${mode}`)
    contributionModes[mode] = parsed.contribution
    resolvedModes[mode] = parsed.resolved
  }
  if (!resolvedModes.light && !resolvedModes.dark) fail(`${path}.modes`, 'needs light and/or dark')
  return {
    contribution: {
      id: value.id,
      displayName,
      ...(description ? { description } : {}),
      fonts,
      typography: typography.contribution,
      shape,
      modes: contributionModes,
    },
    resolved: {
      id: value.id,
      displayName,
      ...(description ? { description } : {}),
      fonts,
      typography: { body: typography.body, heading: typography.heading, scale: typography.scale },
      shape,
      modes: resolvedModes,
    },
  }
}

/**
 * Validates `contributes.panelThemes`. Throws PanelThemeValidationError with a
 * sanitised diagnostic (<= 200 chars) on the first violation.
 */
export function parsePanelThemes(value: unknown): PanelThemeParseResult {
  if (!Array.isArray(value) || value.length < 1 || value.length > PANEL_THEME_MAX_THEMES) {
    fail('panelThemes', `must be an array of 1-${PANEL_THEME_MAX_THEMES} themes`)
  }
  const contributions: PluginPanelThemeContribution[] = []
  const themes: ResolvedPanelTheme[] = []
  const ids = new Set<string>()
  const fontFiles = new Set<string>()
  const imageFiles = new Set<string>()
  value.forEach((raw, index) => {
    const parsed = parseTheme(raw, index)
    if (ids.has(parsed.resolved.id)) fail(parsed.resolved.id, 'duplicate theme id')
    ids.add(parsed.resolved.id)
    for (const face of parsed.resolved.fonts) fontFiles.add(face.src)
    for (const mode of Object.values(parsed.resolved.modes)) {
      if (mode?.background.type === 'image') imageFiles.add(mode.background.src)
    }
    contributions.push(parsed.contribution)
    themes.push(parsed.resolved)
  })
  if (fontFiles.size > PANEL_THEME_MAX_FONT_FILES) fail('panelThemes', `at most ${PANEL_THEME_MAX_FONT_FILES} distinct font files per plugin`)
  if (imageFiles.size > PANEL_THEME_MAX_IMAGE_FILES) fail('panelThemes', `at most ${PANEL_THEME_MAX_IMAGE_FILES} distinct images per plugin`)
  return { contributions, themes }
}

/** Non-throwing wrapper for callers that only need the resolved themes. */
export function resolvePanelThemes(value: unknown): ResolvedPanelTheme[] | null {
  try {
    return parsePanelThemes(value).themes
  } catch {
    return null
  }
}

// ── Package asset rules (spec §5.1) ──────────────────────────────────────
export interface PanelThemeAssetPaths {
  images: Set<string>
  fonts: Set<string>
}

export function panelThemeAssetPaths(themes: readonly Pick<PluginPanelThemeContribution, 'fonts' | 'modes'>[] | undefined): PanelThemeAssetPaths {
  const images = new Set<string>()
  const fonts = new Set<string>()
  for (const theme of themes ?? []) {
    for (const face of theme.fonts) fonts.add(face.src)
    for (const mode of Object.values(theme.modes)) {
      if (mode?.background.type === 'image') images.add(mode.background.src)
    }
  }
  return { images, fonts }
}

export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32
}

export type PanelThemeImageKind = 'image/png' | 'image/webp' | 'image/jpeg'

export function panelThemeImageType(bytes: Uint8Array): PanelThemeImageKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

export type PanelThemeImageCheck =
  | { ok: true; type: PanelThemeImageKind; width: number; height: number }
  | { ok: false; error: 'image_invalid' | 'image_too_large' | 'image_animated' }

interface ImageRules {
  maxBytes: number
  maxSide: number
  maxPixels: number
  types: readonly PanelThemeImageKind[]
  requireUpright: boolean
}

const PACKAGED_IMAGE_RULES: ImageRules = {
  maxBytes: PANEL_THEME_IMAGE_MAX_BYTES,
  maxSide: PANEL_THEME_IMAGE_MAX_SIDE,
  maxPixels: PANEL_THEME_IMAGE_MAX_PIXELS,
  types: ['image/png', 'image/webp'],
  requireUpright: true,
}

const USER_IMAGE_RULES: ImageRules = {
  maxBytes: PANEL_THEME_USER_IMAGE_MAX_BYTES,
  maxSide: PANEL_THEME_USER_IMAGE_MAX_SIDE,
  maxPixels: PANEL_THEME_USER_IMAGE_MAX_PIXELS,
  types: ['image/png', 'image/jpeg', 'image/webp'],
  requireUpright: false,
}

/** Header-only checks; nothing is decoded. */
function checkImage(bytes: Uint8Array, rules: ImageRules): PanelThemeImageCheck {
  if (bytes.byteLength > rules.maxBytes) return { ok: false, error: 'image_too_large' }
  const type = panelThemeImageType(bytes)
  if (!type || !rules.types.includes(type)) return { ok: false, error: 'image_invalid' }
  const size = readImageSize(bytes)
  if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)) return { ok: false, error: 'image_invalid' }
  if (size.width < PANEL_THEME_IMAGE_MIN_SIDE || size.height < PANEL_THEME_IMAGE_MIN_SIDE) return { ok: false, error: 'image_invalid' }
  if (size.width > rules.maxSide || size.height > rules.maxSide || size.width * size.height > rules.maxPixels) {
    return { ok: false, error: 'image_too_large' }
  }
  if (readImageAnimated(bytes)) return { ok: false, error: 'image_animated' }
  if (rules.requireUpright && readImageOrientation(bytes) !== 1) return { ok: false, error: 'image_invalid' }
  return { ok: true, type, width: size.width, height: size.height }
}

export function checkPanelThemePackagedImage(bytes: Uint8Array): PanelThemeImageCheck {
  return checkImage(bytes, PACKAGED_IMAGE_RULES)
}

export function checkPanelThemeUserImage(bytes: Uint8Array): PanelThemeImageCheck {
  return checkImage(bytes, USER_IMAGE_RULES)
}

// ── Catalog builder (spec §7.1) ──────────────────────────────────────────
export interface PanelThemeSourcePlugin {
  pluginId: string
  version: string
  pluginName: PluginLocalizedText
  /** Installed, enabled, and the global plugin switch is on. */
  available: boolean
  unavailableReason?: Exclude<PanelThemeUnavailableReason, 'theme_removed'>
  themes: readonly ResolvedPanelTheme[]
}

export interface PanelThemeAssetResolver {
  /** Returns the protocol URL for a packaged image or font (records its token). */
  packagedUrl(kind: 'image' | 'font', pluginId: string, version: string, relativePath: string): string
  fontAlias(pluginId: string, version: string, themeId: string, fontId: string): string
  /** Returns the protocol URL for a stored user image, or null when it cannot be served. */
  userImageUrl(pluginId: string, file: string): string | null
}

function familyValue(entries: readonly PanelThemeFamilyEntry[] | null, fallback: string, alias: (fontId: string) => string): string {
  if (!entries) return fallback
  return entries.map(entry => {
    if (entry.kind === 'generic') return entry.name
    if (entry.kind === 'font') return `"${alias(entry.id)}"`
    return `"${entry.name}"`
  }).join(', ')
}

export function panelThemeSharedProperties(theme: ResolvedPanelTheme, alias: (fontId: string) => string): Partial<Record<PanelThemeSharedProperty, string>> {
  const properties: Partial<Record<PanelThemeSharedProperty, string>> = {
    '--organic-font-body': familyValue(theme.typography.body, DEFAULT_BODY_FAMILY, alias),
    '--organic-font-heading': familyValue(theme.typography.heading, DEFAULT_HEADING_FAMILY, alias),
  }
  for (const [property, base] of BASE_FONT_SIZES) {
    properties[property] = `${Math.max(FONT_FLOOR_PX, Math.round(base * theme.typography.scale))}px`
  }
  properties['--organic-radius-sm'] = `${theme.shape.radiusSm}px`
  properties['--organic-radius-md'] = `${theme.shape.radiusMd}px`
  properties['--organic-radius-lg'] = `${theme.shape.radiusLg}px`
  return properties
}

export function petStatusProperties(colors: Record<PetStatusColorKey, PanelThemeRgba>): Record<PetStatusProperty, string> {
  const properties = {} as Record<PetStatusProperty, string>
  for (const token of PET_STATUS_TOKENS) properties[token.property] = formatPanelThemeColor(colors[token.key])
  // Opaque copy for reduced transparency / increased contrast fallbacks.
  properties['--pet-status-background-opaque'] = formatPanelThemeColor(withAlpha(colors.background, 1))
  return properties
}

function colorProperties(colors: ColorSet): Record<PanelThemeColorProperty, string> {
  const properties = {} as Record<PanelThemeColorProperty, string>
  for (const token of PANEL_THEME_COLOR_TOKENS) properties[token.property] = formatPanelThemeColor(colors[token.key])
  return properties
}

function backgroundState(background: ResolvedPanelThemeBackground, imageUrl: (src: string) => string): PanelThemeBackgroundState {
  if (background.type === 'solid') return { type: 'solid' }
  if (background.type === 'image') {
    return {
      type: 'image',
      url: imageUrl(background.src),
      fit: background.fit,
      position: background.position,
      opacity: background.opacity,
      blur: background.blur,
      overlay: { color: formatPanelThemeColor(background.overlay.color), opacity: background.overlay.opacity },
    }
  }
  const stops = background.stops.map(stop => ({ color: formatPanelThemeColor(stop.color), at: stop.at }))
  return background.kind === 'linear'
    ? { type: 'gradient', kind: 'linear', angle: background.angle, stops }
    : { type: 'gradient', kind: 'radial', position: background.position, stops }
}

function catalogEntry(source: PanelThemeSourcePlugin, theme: ResolvedPanelTheme, store: PanelThemeStoreData, resolver: PanelThemeAssetResolver): PanelThemeCatalogEntry {
  const alias = (fontId: string) => resolver.fontAlias(source.pluginId, source.version, theme.id, fontId)
  const modes: PanelThemeCatalogEntry['modes'] = {}
  for (const mode of MODES) {
    const resolved = theme.modes[mode]
    if (!resolved) continue
    const state: PanelThemeModeState = {
      properties: colorProperties(resolved.colors),
      ...(resolved.petStatus ? { petStatus: petStatusProperties(resolved.petStatus) } : {}),
      background: backgroundState(resolved.background, src => resolver.packagedUrl('image', source.pluginId, source.version, src)),
    }
    if (resolved.userImage) {
      const stored = store.userImages[source.pluginId]?.[theme.id]?.[mode]
      const url = stored ? resolver.userImageUrl(source.pluginId, stored.file) : null
      state.userImage = {
        minDim: resolved.userImage.minDim,
        defaultDim: resolved.userImage.defaultDim,
        fit: resolved.userImage.fit,
        overlayColor: formatPanelThemeColor(resolved.userImage.overlayColor),
        ...(stored && url ? {
          current: {
            url,
            fit: stored.fit,
            position: stored.position,
            dim: stored.dim >= resolved.userImage.minDim ? stored.dim : resolved.userImage.defaultDim,
            blur: stored.blur,
            width: stored.width,
            height: stored.height,
          },
        } : {}),
      }
    }
    modes[mode] = state
  }
  return {
    ref: { pluginId: source.pluginId, themeId: theme.id },
    pluginName: { ...source.pluginName },
    displayName: { ...theme.displayName },
    ...(theme.description ? { description: { ...theme.description } } : {}),
    shared: {
      properties: panelThemeSharedProperties(theme, alias),
      fonts: theme.fonts.map(face => ({
        alias: alias(face.id),
        url: resolver.packagedUrl('font', source.pluginId, source.version, face.src),
        weight: face.weight,
        style: face.style,
      })),
    },
    modes,
  }
}

function slotState(ref: PanelThemeRef | null, mode: PanelThemeMode, sources: ReadonlyMap<string, PanelThemeSourcePlugin>): PanelThemeSlotState {
  if (!ref) return { ref: null, status: 'builtin' }
  const source = sources.get(ref.pluginId)
  const theme = source?.themes.find(candidate => candidate.id === ref.themeId)
  if (!source || !theme || !theme.modes[mode]) return { ref: { ...ref }, status: 'unavailable', reason: 'theme_removed' }
  if (!source.available) return { ref: { ...ref }, status: 'unavailable', reason: source.unavailableReason ?? 'plugin_disabled' }
  return { ref: { ...ref }, status: 'active' }
}

/** The full built-in palette for a mode as canonical properties. */
export function builtinPanelThemeProperties(mode: PanelThemeMode): Record<PanelThemeColorProperty, string> {
  const properties = {} as Record<PanelThemeColorProperty, string>
  for (const token of PANEL_THEME_COLOR_TOKENS) properties[token.property] = formatPanelThemeColor(builtinColor(token, mode))
  return properties
}

const BUILTIN_PROPERTIES = { light: builtinPanelThemeProperties('light'), dark: builtinPanelThemeProperties('dark') }

/** Builds the renderer state: slot statuses plus the themes of every available plugin. */
export function buildPanelThemeState(
  sources: readonly PanelThemeSourcePlugin[],
  store: PanelThemeStoreData,
  resolver: PanelThemeAssetResolver,
): PanelThemeState {
  const byId = new Map(sources.map(source => [source.pluginId, source] as const))
  const themes: PanelThemeCatalogEntry[] = []
  for (const source of sources) {
    if (!source.available) continue
    for (const theme of source.themes) themes.push(catalogEntry(source, theme, store, resolver))
  }
  return {
    slots: {
      light: slotState(store.slots.light, 'light', byId),
      dark: slotState(store.slots.dark, 'dark', byId),
    },
    themes,
    builtin: { light: { ...BUILTIN_PROPERTIES.light }, dark: { ...BUILTIN_PROPERTIES.dark } },
  }
}

export function emptyPanelThemeState(): PanelThemeState {
  return {
    slots: { light: { ref: null, status: 'builtin' }, dark: { ref: null, status: 'builtin' } },
    themes: [],
    builtin: { light: { ...BUILTIN_PROPERTIES.light }, dark: { ...BUILTIN_PROPERTIES.dark } },
  }
}

/** True when the (plugin, theme, mode) exists in the sources and allows a user image. */
export function panelThemeAllowsUserImage(sources: readonly PanelThemeSourcePlugin[], ref: PanelThemeRef, mode: PanelThemeMode): boolean {
  const theme = sources.find(source => source.pluginId === ref.pluginId)?.themes.find(candidate => candidate.id === ref.themeId)
  return Boolean(theme?.modes[mode]?.userImage)
}

/** Minimum user dim for a (plugin, theme, mode), or null when user images are not allowed there. */
export function panelThemeUserImageMinimum(sources: readonly PanelThemeSourcePlugin[], ref: PanelThemeRef, mode: PanelThemeMode): number | null {
  const theme = sources.find(source => source.pluginId === ref.pluginId)?.themes.find(candidate => candidate.id === ref.themeId)
  return theme?.modes[mode]?.userImage?.minDim ?? null
}
