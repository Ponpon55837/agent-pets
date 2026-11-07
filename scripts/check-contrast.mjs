#!/usr/bin/env node
// WCAG contrast guard for the token pairs listed in PAIRS. Resolves hex
// values (following var() aliases) from src/styles/tokens.css and asserts
// each pair meets its minimum ratio. Fails (exit 1) on any violation.
// Only opaque hex tokens are checked; translucent tokens depend on the
// backdrop and are verified visually (see liquid-glass.md).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const tokensPath = join(here, '..', 'src', 'styles', 'tokens.css')

// [foreground token, background token, minimum ratio, note]
// 4.5 = body text, 3 = large text / UI graphics / focus indicators.
export const PAIRS = [
  // Panel (organic) layer
  ['--organic-text', '--organic-bg', 4.5, 'body text'],
  ['--organic-text', '--organic-surface', 4.5, 'body text on card'],
  ['--organic-text-secondary', '--organic-surface', 4.5, 'secondary text'],
  ['--organic-text-secondary', '--organic-surface-2', 4.5, 'secondary text on hover'],
  ['--organic-text-muted', '--organic-bg', 4.5, 'muted text'],
  ['--organic-text-muted', '--organic-surface', 4.5, 'muted text on card'],
  ['--organic-text-muted', '--organic-surface-2', 4.5, 'muted text on hover'],
  ['--organic-text-faint', '--organic-surface', 3, 'decorative only, never text'],
  ['--organic-accent-text', '--organic-surface', 4.5, 'accent used as text'],
  ['--organic-accent-contrast', '--organic-accent-hover', 4.5, 'primary button label'],
  ['--organic-danger-text', '--organic-surface', 4.5, 'danger text'],
  ['--organic-success-text', '--organic-surface', 4.5, 'success text'],
  ['--organic-warn-text', '--organic-surface', 4.5, 'warning text'],
  ['--organic-danger-text', '--organic-surface-2', 4.5, 'danger text on hover'],
  ['--organic-warn-text', '--organic-surface-2', 4.5, 'warning text on hover'],
  ['--organic-success-text', '--organic-surface-2', 4.5, 'success text on hover'],
  // Pet / dark layer (against the opaque fallback base)
  ['--text-primary', '--dark-base', 4.5, 'body text'],
  ['--text-secondary', '--dark-base', 4.5, 'secondary text'],
  ['--text-muted', '--dark-base', 4.5, 'muted text'],
  ['--accent', '--dark-base', 4.5, 'accent used as text'],
  ['--accent-on', '--accent', 4.5, 'primary button label'],
  ['--state-idle', '--dark-base', 4.5, 'idle state (may carry text)'],
  ['--state-offline', '--dark-base', 3, 'offline state graphic'],
  ['--focus-ring-color', '--dark-base', 3, 'focus ring'],
  ['--focus-ring-color-on-light', '--organic-surface', 3, 'focus ring on cream'],
]

// The dark layer renders over an arbitrary wallpaper; this is the opaque
// colour of the reduced-transparency fallback (rgba(18,18,26) fully opaque).
const EXTRA = { '--dark-base': '#12121a' }

export function parseTokens(css = readFileSync(tokensPath, 'utf8')) {
  const map = { ...EXTRA }
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of stripped.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!(m[1] in map)) map[m[1]] = m[2].trim()
  }
  return map
}

export function resolveHex(map, name, depth = 0) {
  const value = map[name]
  if (!value || depth > 8) return null
  const alias = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i)
  if (alias) return resolveHex(map, alias[1], depth + 1)
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!hex) return null
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
  return `#${h.toLowerCase()}`
}

export function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function evaluate(map = parseTokens()) {
  return PAIRS.map(([fg, bg, min, note]) => {
    const f = resolveHex(map, fg)
    const b = resolveHex(map, bg)
    const ratio = f && b ? contrast(f, b) : null
    return { fg, bg, min, note, ratio, ok: ratio !== null && ratio >= min }
  })
}

function main() {
  const results = evaluate()
  let failed = 0
  for (const r of results) {
    const shown = r.ratio === null ? 'unresolved' : r.ratio.toFixed(2)
    if (!r.ok) failed++
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${shown.padStart(6)} (min ${r.min})  ${r.fg} on ${r.bg}  — ${r.note}`)
  }
  if (failed) {
    console.error(`${failed} contrast pair(s) below threshold`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
