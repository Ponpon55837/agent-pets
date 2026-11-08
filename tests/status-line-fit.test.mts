import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  STATUS_LINE_GEOMETRY as g,
  fitStatusLine,
  statusLineContentWidth,
  type MeasureText,
  type StatusLineFit,
  type StatusLineFitInput,
} from '../src/utils/status-line-fit.ts'

// Canvas widths measured in the isolated Electron runner on macOS (system UI font at 12px / 11px,
// the heading font at 15px for the quota number). Unlisted text falls back to a wide per-character estimate.
const MEASURED: Record<string, number> = {
  'state:Idle': 20.47, 'state:Thinking': 48.43, 'state:Working': 46.48, 'state:Permission': 61.9,
  'state:Needs input': 68.3, 'state:Done': 29.67, 'state:Failed': 33.3, 'state:Offline': 37.8, 'state:·': 3.56,
  'label:Codex': 37.36, 'label:Claude': 41.2, 'label:OpenCode': 62.31, 'label:00': 16,
  'badge:Build': 27.69, 'badge:Deploy': 37.94, 'badge:+3': 14.57,
  'readout:100%': 37.28, 'readout:71%': 28.94, 'readout:40%': 28.94,
}
const PER_CHAR = { label: 7.4, state: 6.6, badge: 6.4, readout: 9.4 } as const
const measure: MeasureText = (text, part) => MEASURED[`${part}:${text}`] ?? Array.from(text).length * PER_CHAR[part]

const STATES = ['Idle', 'Thinking', 'Working', 'Permission', 'Needs input', 'Done', 'Failed', 'Offline']
const LABELS = ['Codex', 'Claude', 'OpenCode']

function usedWidth(input: StatusLineFitInput, fit: StatusLineFit): number {
  const sep = measure('·', 'state') + g.sepMargin
  const labelFull = input.label ? measure(input.label, 'label') + sep : 0
  const labelMin = input.label ? Math.min(labelFull, measure('00', 'label') + sep) : 0
  const items = [g.dot, measure(input.state, 'state')]
  if (fit.showLabel && input.label) items.push(fit.badgeCount > 0 || fit.showOverflow ? labelFull : labelMin)
  if (fit.showReadout && input.readout) items.push(Math.max(g.readoutMin, measure(input.readout, 'readout')))
  const group = [
    ...input.badges.slice(0, fit.badgeCount).map(text => Math.min(g.badgeMax, measure(text, 'badge') + g.badgeChrome)),
    ...(fit.showOverflow && input.hiddenCount > 0 ? [Math.min(g.overflowMax, measure(`+${input.hiddenCount}`, 'badge') + g.badgeChrome)] : []),
  ]
  if (group.length > 0) items.push(group.reduce((a, b) => a + b, 0) + g.badgeGap * (group.length - 1))
  return items.reduce((a, b) => a + b, 0) + g.gap * (items.length - 1)
}

const worst = (label: string, state: string, contentWidth: number): StatusLineFitInput => ({
  contentWidth, label, state, readout: '100%', badges: ['Build', 'Deploy'], hiddenCount: 3,
})

test('the state always fits, with quota and two badges plus +N, at every pet size and in both layouts', () => {
  const widths = [
    statusLineContentWidth(false, 1),
    ...[0.6, 0.8, 1].map(scale => statusLineContentWidth(true, scale)),
  ]
  for (const contentWidth of widths) {
    for (const label of LABELS) {
      for (const state of STATES) {
        const input = worst(label, state, contentWidth)
        const fit = fitStatusLine(input, measure)
        assert.ok(usedWidth(input, fit) <= contentWidth, `${contentWidth}px ${label} ${state}: ${JSON.stringify(fit)}`)
      }
    }
  }
})

test('single pet: the name and quota stay; badges make room, +N first', () => {
  const contentWidth = statusLineContentWidth(false, 1)
  const one = (state: string, badges: string[], hiddenCount: number) =>
    fitStatusLine({ contentWidth, label: 'Claude', state, readout: '71%', badges, hiddenCount }, measure)
  assert.deepEqual(one('Working', ['Build'], 0), { showLabel: true, showReadout: true, badgeCount: 1, showOverflow: false })
  assert.deepEqual(one('Idle', ['Build', 'Deploy'], 0), { showLabel: true, showReadout: true, badgeCount: 2, showOverflow: false })
  // Two badges (plus +N) are more than a 236px pill holds next to a longer state: +N goes, then the last badge.
  assert.deepEqual(one('Working', ['Build', 'Deploy'], 0), { showLabel: true, showReadout: true, badgeCount: 1, showOverflow: false })
  assert.deepEqual(one('Permission', ['Build', 'Deploy'], 3), { showLabel: true, showReadout: true, badgeCount: 1, showOverflow: false })
})

test('things are given up in order: +N, badges from the end, the name, the quota number', () => {
  const at = (contentWidth: number) => fitStatusLine(worst('OpenCode', 'Needs input', contentWidth), measure)
  const seen: StatusLineFit[] = []
  for (let width = 400; width >= 60; width -= 1) {
    const fit = at(width)
    const prev = seen.at(-1)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(fit)) seen.push(fit)
  }
  assert.deepEqual(seen, [
    { showLabel: true, showReadout: true, badgeCount: 2, showOverflow: true },
    { showLabel: true, showReadout: true, badgeCount: 2, showOverflow: false },
    { showLabel: true, showReadout: true, badgeCount: 1, showOverflow: false },
    { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false },
    { showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false },
    { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false },
  ])
})

test('multi pet at the small size keeps dot + state, then the quota number when it fits', () => {
  const contentWidth = statusLineContentWidth(true, 0.6)
  assert.equal(contentWidth, 112 - g.chromeX)
  const longest = fitStatusLine(worst('OpenCode', 'Needs input', contentWidth), measure)
  assert.deepEqual(longest, { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false })
  const short = fitStatusLine({ contentWidth, label: 'Codex', state: 'Idle', readout: '40%', badges: [], hiddenCount: 0 }, measure)
  assert.deepEqual(short, { showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false })
  // Without a quota a short state also keeps its name.
  const noQuota = fitStatusLine({ contentWidth, label: 'Codex', state: 'Idle', readout: null, badges: [], hiddenCount: 0 }, measure)
  assert.equal(noQuota.showLabel, true)
})

test('multi pet with Permission and a quota: the name shows at the large size, then the name and the quota number give way', () => {
  const at = (scale: number) => fitStatusLine({ contentWidth: statusLineContentWidth(true, scale), label: 'Codex', state: 'Permission', readout: '40%', badges: ['Build'], hiddenCount: 0 }, measure)
  assert.deepEqual(at(1), { showLabel: true, showReadout: true, badgeCount: 0, showOverflow: false })
  assert.deepEqual(at(0.8), { showLabel: false, showReadout: true, badgeCount: 0, showOverflow: false })
  assert.deepEqual(at(0.6), { showLabel: false, showReadout: false, badgeCount: 0, showOverflow: false })
})

test('the geometry constants match DesktopPet.css', () => {
  const css = readFileSync(new URL('../src/components/DesktopPet.css', import.meta.url), 'utf8')
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    assert.ok(start >= 0, selector)
    return css.slice(start, css.indexOf('}', start))
  }
  assert.match(rule('.status-line'), /gap: 5px;/)
  assert.match(rule('.status-line'), /padding: 3px 9px;/)
  assert.match(rule('.status-line'), /border: 1px solid/)
  assert.match(rule('.line-dot'), /width: 8px;/)
  assert.match(rule('.line-sep'), /margin-left: 3px;/)
  assert.match(rule('.line-text + .line-state'), /margin-left: -2px;/)
  assert.equal(g.sepMargin, 3 - 2)
  assert.match(rule('.plugin-status-badges'), /gap: 3px;/)
  assert.match(rule('.plugin-badge-anchor'), /flex: 0 1 42px;/)
  assert.match(rule('.plugin-badge-pill'), /padding: 0 5px;/)
  assert.match(rule('.plugin-badge-overflow'), /max-width: 36px;/)
  assert.match(rule('.quota-readout'), /min-width: 25px;/)
  assert.match(rule('.multi-pet-status-line'), /width: max\(calc\(192px \* var\(--pet-scale, 1\) - 12px\), 112px\);/)
  assert.match(rule('.status-line'), /max-width: calc\(var\(--pet-w, 250px\) - 14px\);/)
  assert.equal(g.chromeX, 2 * 9 + 2 * 1)
  assert.equal(g.badgeChrome, 2 * 5 + 2 * 1)
})
