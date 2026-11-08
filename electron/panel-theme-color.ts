// Closed colour grammar for plugin panel themes (spec §3.3). Pure: no Electron
// or Node imports, so the catalog validator can vendor this file unchanged.
//
// Every accepted form is matched by an anchored regular expression that can
// only describe one function call made of digits, '.', '%', ',', '/', spaces
// and a fixed unit, so `;`, `}`, `\`, quotes, url(), var(), calc() and named
// colours can never get through. Accepted colours are converted to sRGB and
// re-emitted by the host as `rgb(R G B / A)`; a plugin string never reaches CSS.

export interface PanelThemeRgba {
  /** 0–255, integer after normalisation. */
  r: number
  g: number
  b: number
  /** 0–1, at most 3 decimals after normalisation. */
  a: number
}

export type PanelThemeColorError = 'invalid_color' | 'out_of_range' | 'out_of_gamut'

export type PanelThemeColorResult =
  | { ok: true; color: PanelThemeRgba }
  | { ok: false; error: PanelThemeColorError }

export const PANEL_THEME_COLOR_MAX_LENGTH = 64

const NUM = String.raw`(?:\d{1,3}(?:\.\d{1,4})?|\.\d{1,4})`
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGB_COMMA = new RegExp(String.raw`^rgba?\((${NUM}%?), ?(${NUM}%?), ?(${NUM}%?)(?:, ?(${NUM}%?))?\)$`)
const RGB_SPACE = new RegExp(String.raw`^rgba?\((${NUM}%?) (${NUM}%?) (${NUM}%?)(?: \/ (${NUM}%?))?\)$`)
const HSL_COMMA = new RegExp(String.raw`^hsla?\((${NUM})(?:deg)?, ?(${NUM})%, ?(${NUM})%(?:, ?(${NUM}%?))?\)$`)
const HSL_SPACE = new RegExp(String.raw`^hsla?\((${NUM})(?:deg)? (${NUM})% (${NUM})%(?: \/ (${NUM}%?))?\)$`)
const OKLCH = new RegExp(String.raw`^oklch\((${NUM}%?) (${NUM}) (${NUM})(?:deg)?(?: \/ (${NUM}%?))?\)$`)

const CHANNEL = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)'
/** The only colour string shape the host ever emits (and the renderer accepts). */
export const PANEL_THEME_CANONICAL_RGB = new RegExp(`^rgb\\(${CHANNEL} ${CHANNEL} ${CHANNEL} \\/ (?:0|1|0\\.\\d{0,2}[1-9])\\)$`)

const GAMUT_EPSILON = 0.0001

function isPercent(token: string): boolean {
  return token.endsWith('%')
}

function numberOf(token: string): number {
  return Number(isPercent(token) ? token.slice(0, -1) : token)
}

/** Alpha: 0–1 or 0–100%. Returns null when out of range. */
function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1
  const value = numberOf(token)
  if (isPercent(token)) return value <= 100 ? value / 100 : null
  return value <= 1 ? value : null
}

function roundAlpha(value: number): number {
  return Math.round(value * 1000) / 1000
}

function channel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function parseHex(value: string): PanelThemeRgba {
  const digits = value.slice(1)
  const expand = digits.length <= 4 ? [...digits].map(digit => digit + digit).join('') : digits
  const r = Number.parseInt(expand.slice(0, 2), 16)
  const g = Number.parseInt(expand.slice(2, 4), 16)
  const b = Number.parseInt(expand.slice(4, 6), 16)
  const a = expand.length === 8 ? Number.parseInt(expand.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a: roundAlpha(a) }
}

function parseRgb(match: RegExpExecArray): PanelThemeColorResult {
  const tokens = [match[1]!, match[2]!, match[3]!]
  const percent = isPercent(tokens[0]!)
  if (tokens.some(token => isPercent(token) !== percent)) return { ok: false, error: 'invalid_color' }
  const values = tokens.map(numberOf)
  if (values.some(value => value > (percent ? 100 : 255))) return { ok: false, error: 'out_of_range' }
  const alpha = parseAlpha(match[4])
  if (alpha === null) return { ok: false, error: 'out_of_range' }
  const [r, g, b] = values.map(value => channel(percent ? (value * 255) / 100 : value))
  return { ok: true, color: { r: r!, g: g!, b: b!, a: roundAlpha(alpha) } }
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const s = saturation / 100
  const l = lightness / 100
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

function parseHsl(match: RegExpExecArray): PanelThemeColorResult {
  const hue = Number(match[1])
  const saturation = Number(match[2])
  const lightness = Number(match[3])
  if (hue > 360 || saturation > 100 || lightness > 100) return { ok: false, error: 'out_of_range' }
  const alpha = parseAlpha(match[4])
  if (alpha === null) return { ok: false, error: 'out_of_range' }
  const [r, g, b] = hslToRgb(hue % 360, saturation, lightness).map(channel)
  return { ok: true, color: { r: r!, g: g!, b: b!, a: roundAlpha(alpha) } }
}

function encodeSrgb(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear))
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
}

/** OKLCH -> OKLab -> LMS -> linear sRGB (Ottosson). Null when outside the sRGB gamut. */
export function oklchToLinearSrgb(lightness: number, chroma: number, hueDegrees: number): [number, number, number] | null {
  const radians = (hueDegrees * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const linear: [number, number, number] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  return linear.every(value => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON) ? linear : null
}

function parseOklch(match: RegExpExecArray): PanelThemeColorResult {
  const lightnessToken = match[1]!
  const lightnessValue = numberOf(lightnessToken)
  const lightness = isPercent(lightnessToken) ? lightnessValue / 100 : lightnessValue
  const chroma = Number(match[2])
  const hue = Number(match[3])
  if ((isPercent(lightnessToken) ? lightnessValue > 100 : lightnessValue > 1) || chroma > 0.4 || hue > 360) {
    return { ok: false, error: 'out_of_range' }
  }
  const alpha = parseAlpha(match[4])
  if (alpha === null) return { ok: false, error: 'out_of_range' }
  const linear = oklchToLinearSrgb(lightness, chroma, hue % 360)
  if (!linear) return { ok: false, error: 'out_of_gamut' }
  const [r, g, b] = linear.map(value => channel(encodeSrgb(value) * 255))
  return { ok: true, color: { r: r!, g: g!, b: b!, a: roundAlpha(alpha) } }
}

/** Parses one manifest colour with the closed grammar. Never throws. */
export function parsePanelThemeColor(value: unknown): PanelThemeColorResult {
  if (typeof value !== 'string' || value.length < 4 || value.length > PANEL_THEME_COLOR_MAX_LENGTH) {
    return { ok: false, error: 'invalid_color' }
  }
  if (value.charCodeAt(0) === 0x23) {
    return HEX.test(value) ? { ok: true, color: parseHex(value) } : { ok: false, error: 'invalid_color' }
  }
  let match = RGB_COMMA.exec(value) ?? RGB_SPACE.exec(value)
  if (match) return parseRgb(match)
  match = HSL_COMMA.exec(value) ?? HSL_SPACE.exec(value)
  if (match) return parseHsl(match)
  match = OKLCH.exec(value)
  if (match) return parseOklch(match)
  return { ok: false, error: 'invalid_color' }
}

function formatAlpha(alpha: number): string {
  const rounded = roundAlpha(alpha)
  if (rounded >= 1) return '1'
  if (rounded <= 0) return '0'
  return String(rounded)
}

/** The canonical host string: `rgb(R G B / A)`. */
export function formatPanelThemeColor(color: PanelThemeRgba): string {
  return `rgb(${channel(color.r)} ${channel(color.g)} ${channel(color.b)} / ${formatAlpha(color.a)})`
}

export function isCanonicalPanelThemeColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && PANEL_THEME_CANONICAL_RGB.test(value)
}

/** Per-channel sRGB mix, rounded (spec §3.5). Alpha of `a` is kept. */
export function mixColor(a: PanelThemeRgba, b: PanelThemeRgba, t: number): PanelThemeRgba {
  return {
    r: channel(a.r * (1 - t) + b.r * t),
    g: channel(a.g * (1 - t) + b.g * t),
    b: channel(a.b * (1 - t) + b.b * t),
    a: a.a,
  }
}

export function withAlpha(color: PanelThemeRgba, alpha: number): PanelThemeRgba {
  return { r: color.r, g: color.g, b: color.b, a: roundAlpha(alpha) }
}

/** Source-over in sRGB gamma space (what Chromium paints). Result is opaque and unrounded. */
export function compositeColor(foreground: PanelThemeRgba, background: PanelThemeRgba): PanelThemeRgba {
  const alpha = foreground.a
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  }
}

function linearChannel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function relativeLuminance(color: PanelThemeRgba): number {
  return 0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b)
}

/** Contrast ratio; a translucent foreground is composited over the (opaque) background first. */
export function contrastRatio(foreground: PanelThemeRgba, background: PanelThemeRgba): number {
  const painted = foreground.a < 1 ? compositeColor(foreground, background) : foreground
  const first = relativeLuminance(painted)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export const PANEL_THEME_BLACK: PanelThemeRgba = Object.freeze({ r: 0, g: 0, b: 0, a: 1 })
export const PANEL_THEME_WHITE: PanelThemeRgba = Object.freeze({ r: 255, g: 255, b: 255, a: 1 })
