import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { derivePetStatusColors, parsePanelThemes, PanelThemeValidationError, PET_STATUS_TOKENS, petStatusProperties } from '../electron/plugin-panel-themes.ts'
import { contrastRatio, compositeColor, parsePanelThemeColor, type PanelThemeRgba } from '../electron/panel-theme-color.ts'
import { petStatusTargetProperties } from '../src/utils/panel-theme-css.ts'
import { PET_STATUS_PROPERTIES } from '../src/types/panel-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, theme } from './support/panel-theme-fixtures.mts'

const color = (value: string): PanelThemeRgba => {
  const parsed = parsePanelThemeColor(value)
  if (!parsed.ok) throw new Error(value)
  return parsed.color
}

const withPill = (petStatus: unknown, mode: 'light' | 'dark' = 'dark') => [theme({
  modes: { [mode]: { colors: mode === 'dark' ? DARK_COLORS : LIGHT_COLORS, petStatus } },
})]

function rejects(value: unknown, pattern: RegExp): void {
  assert.throws(() => parsePanelThemes(value), (error: unknown) => error instanceof PanelThemeValidationError && pattern.test(error.diagnostic))
}

test('petStatus: background and text are required, the rest is derived deterministically', () => {
  const [resolved] = parsePanelThemes(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#e6f4f5' })).themes
  const pill = resolved!.modes.dark!.petStatus!
  assert.deepEqual(pill.border, { ...color('#e6f4f5'), a: 0.18 })
  assert.deepEqual(pill.quotaTrack, { ...color('#e6f4f5'), a: 0.18 })
  assert.deepEqual(pill.quotaFill, color(DARK_COLORS.accent))
  // 推導是輸入的純函式。
  assert.deepEqual(derivePetStatusColors({ background: color('rgb(13 27 34 / 0.9)'), text: color('#e6f4f5') }, { accent: color(DARK_COLORS.accent) }), pill)
  rejects(withPill({ text: '#e6f4f5' }), /petStatus\.background: is required/)
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)' }), /petStatus\.text: is required/)
  rejects(withPill({ background: '#0d1b22', text: '#e6f4f5', dot: '#fff' }), /petStatus: unknown key/)
})

test('petStatus: closed grammar, opacity floors and canonical re-emission', () => {
  rejects(withPill({ background: 'rgb(13 27 34 / 0.8)', text: '#e6f4f5' }), /background: alpha must be 0\.85-1/)
  rejects(withPill({ background: '#0d1b22', text: '#e6f4f580' }), /text: must be opaque/)
  rejects(withPill({ background: 'var(--x)', text: '#e6f4f5' }), /background: not an allowed colour/)
  rejects(withPill({ background: '#0d1b22', text: 'red;}body{' }), /text: not an allowed colour/)
  rejects(withPill({ background: '#0d1b22', text: '#e6f4f5', quotaTrack: 'rgb(0 0 0 / 0.05)' }), /quotaTrack: alpha must be 0\.1-1/)
  const properties = petStatusProperties(parsePanelThemes(withPill({ background: 'rgba(13,27,34,.9)', text: 'hsl(184 41% 93%)' })).themes[0]!.modes.dark!.petStatus!)
  assert.deepEqual(Object.keys(properties), [...PET_STATUS_PROPERTIES])
  assert.equal(properties['--pet-status-background'], 'rgb(13 27 34 / 0.9)')
  assert.equal(properties['--pet-status-background-opaque'], 'rgb(13 27 34 / 1)')
})

test('petStatus contrast is checked over worst-case black and white desktops', () => {
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#5a6a70' }), /petStatus\.text: [\d.]+:1 < 4\.5:1 on pill over a (black|white) desktop/)
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#e6f4f5', textMuted: '#4a5a60' }), /petStatus\.textMuted/)
  rejects(withPill({ background: 'rgb(13 27 34 / 0.9)', text: '#e6f4f5', quotaFill: '#1d3a40' }), /petStatus\.quotaFill: .* < 3:1/)
  rejects(withPill({ background: 'rgb(248 252 252 / 0.92)', text: '#10282c', quotaFill: '#1f7a80' }, 'light'), /quotaFill: 2\.\d\d:1 < 3:1 on quotaTrack/)
  const [resolved] = parsePanelThemes(withPill({ background: 'rgb(248 252 252 / 0.92)', text: '#10282c', quotaFill: '#0e4f54' }, 'light')).themes
  const pill = resolved!.modes.light!.petStatus!
  // 推導出的低額度顏色會朝文字色移動，直到在所有情況下都達到 3:1。
  for (const desktop of [color('#000000'), color('#ffffff')]) {
    const surface = compositeColor(pill.background, desktop)
    assert.ok(contrastRatio(pill.quotaWarn, surface) >= 3)
    assert.ok(contrastRatio(pill.quotaWarn, compositeColor(pill.quotaTrack, surface)) >= 3)
    assert.ok(contrastRatio(pill.text, surface) >= 4.5)
  }
  assert.equal(PET_STATUS_TOKENS.filter(token => token.required).map(token => token.key).join(), 'background,text')
})

test('pet renderer accepts the full canonical set only, and suspends under forced colours', () => {
  const full = Object.fromEntries(PET_STATUS_PROPERTIES.map(name => [name, 'rgb(1 2 3 / 1)'])) as never
  assert.equal(petStatusTargetProperties({ light: full, dark: null }, 'light', false).size, PET_STATUS_PROPERTIES.length)
  assert.equal(petStatusTargetProperties({ light: full, dark: null }, 'dark', false).size, 0)
  assert.equal(petStatusTargetProperties({ light: full, dark: null }, 'light', true).size, 0)
  assert.equal(petStatusTargetProperties({ light: { ...full, '--pet-status-text': 'red' }, dark: null }, 'light', false).size, 0)
  assert.equal(petStatusTargetProperties({ light: { ...full, '--organic-bg': 'rgb(1 2 3 / 1)' }, dark: null }, 'light', false).has('--organic-bg'), false)
})

test('only the status pill reads --pet-status-*; bubbles, permission UI, dots and badges stay built-in', () => {
  const css = readFileSync('src/components/DesktopPet.css', 'utf8')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*--pet-status-[^{}]*)\}/g)]
  assert.ok(rules.length > 0)
  for (const [, selector] of rules) {
    assert.match(selector!.trim(), /status-line|quota-meter|^\.desktop-pet\[data-pet-status-theme\]/, selector)
    assert.doesNotMatch(selector!, /bubble|permission|badge|tooltip|line-dot|marker|edge|context/, selector)
  }
  for (const file of ['src/components/DesktopPetBubbles.css', 'src/components/permission/PermissionBubble.vue', 'src/components/permission/PermissionNoticeBubble.vue', 'src/components/PetAnimation.css']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /--pet-status-|--organic-bg|panel-theme/, file)
  }
  const pet = readFileSync('src/components/DesktopPet.vue', 'utf8')
  assert.match(pet, /usePetStatusTheme\(petRoot\)/)
  assert.doesNotMatch(pet, /usePanelTheme\b/)
  assert.match(readFileSync('src/components/DesktopPet.css', 'utf8'), /\.status-line\[data-quota-tier='low'\] \{\n  --quota-color: var\(--organic-quota-error\);/)
})
