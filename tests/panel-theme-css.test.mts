import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  activePanelTheme,
  activePanelThemeModes,
  buildPanelThemeGradient,
  diffPanelThemeProperties,
  isPanelThemePropertyValue,
  panelThemeSettingsTarget,
  panelThemeTargetProperties,
} from '../src/utils/panel-theme-css.ts'
import { buildPanelThemeState, PANEL_THEME_COLOR_TOKENS, resolvePanelThemes } from '../electron/plugin-panel-themes.ts'
import { PANEL_THEME_COLOR_PROPERTIES, PANEL_THEME_CSS_PROPERTIES, type PanelThemeState } from '../src/types/panel-theme.ts'
import { DARK_COLORS, LIGHT_COLORS, theme } from './support/panel-theme-fixtures.mts'

function state(slots: PanelThemeState['slots'] = { light: { ref: { pluginId: 'theme-pack', themeId: 'aurora' }, status: 'active' }, dark: { ref: null, status: 'builtin' } }): PanelThemeState {
  const themes = resolvePanelThemes([theme({
    modes: {
      light: { colors: LIGHT_COLORS, background: { type: 'gradient', kind: 'radial', position: 'top-left', stops: [{ color: '#eef6f6', at: 0 }, { color: '#f8fcfc', at: 100 }] } },
      dark: { colors: DARK_COLORS },
    },
  })])!
  const built = buildPanelThemeState(
    [{ pluginId: 'theme-pack', version: '1.0.0', pluginName: { 'zh-TW': '主題包', 'en-US': 'Theme Pack' }, available: true, themes }],
    { version: 1, slots: { light: slots.light.ref, dark: slots.dark.ref }, userImages: {} },
    { packagedUrl: () => `agent-pets://panel-theme/${'a'.repeat(32)}`, fontAlias: () => 'apt-0123456789abcdef', userImageUrl: () => null },
  )
  return { ...built, slots }
}

test('the allowlist matches the main token table and has no duplicates', () => {
  assert.deepEqual(PANEL_THEME_COLOR_TOKENS.map(token => token.property), [...PANEL_THEME_COLOR_PROPERTIES])
  assert.equal(new Set(PANEL_THEME_CSS_PROPERTIES).size, PANEL_THEME_CSS_PROPERTIES.length)
  assert.equal(PANEL_THEME_CSS_PROPERTIES.length, 29 + 2 + 9 + 3 + 1)
})

test('target properties: shared + mode colours + gradient, suspended under forced colours', () => {
  const current = state()
  const entry = activePanelTheme(current, 'light')
  const plan = panelThemeTargetProperties(entry, 'light', { forcedColors: false, highContrast: false })
  assert.deepEqual(plan.rejected, [])
  assert.equal(plan.properties.size, 29 + 14 + 1)
  assert.equal(plan.properties.get('--panel-theme-background'), 'radial-gradient(ellipse at left top, rgb(238 246 246 / 1) 0%, rgb(248 252 252 / 1) 100%)')
  assert.equal(panelThemeTargetProperties(entry, 'light', { forcedColors: true, highContrast: false }).properties.size, 0)
  assert.equal(activePanelTheme(current, 'dark'), null)
  const contrast = panelThemeTargetProperties(entry, 'light', { forcedColors: false, highContrast: true }).properties
  assert.equal(contrast.get('--organic-border'), 'rgb(16 40 44 / 0.6)')
  assert.equal(contrast.get('--organic-border-soft'), 'rgb(16 40 44 / 0.4)')
  assert.equal(activePanelTheme({ ...current, slots: { ...current.slots, light: { ...current.slots.light, status: 'unavailable', reason: 'plugin_disabled' } } }, 'light'), null)
})

test('non-allowlisted names and malformed values are dropped and reported', () => {
  const entry = activePanelTheme(state(), 'light')!
  const tampered = {
    ...entry,
    shared: { ...entry.shared, properties: { ...entry.shared.properties, '--organic-font-body': 'x;}body{color:red', '--organic-radius-sm': '8px;', color: 'red' } as never },
    modes: { light: { ...entry.modes.light!, properties: { ...entry.modes.light!.properties, '--organic-text': 'url(https://example.com)', '--organic-bg': 'var(--x)' } } },
  }
  const plan = panelThemeTargetProperties(tampered, 'light', { forcedColors: false, highContrast: false })
  assert.deepEqual(plan.rejected.sort(), ['--organic-bg', '--organic-font-body', '--organic-radius-sm', '--organic-text', 'color'])
  for (const name of plan.properties.keys()) assert.ok(PANEL_THEME_CSS_PROPERTIES.includes(name))
  for (const [name, value] of [
    ['--organic-font-heading', '"apt-0123456789abcdef", sans-serif'],
    ['--organic-font-body', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'],
    ['--organic-font-label', '14px'],
    ['--organic-text', 'rgb(0 0 0 / 1)'],
  ] as const) assert.equal(isPanelThemePropertyValue(name, value), true, value)
  for (const [name, value] of [
    ['--organic-font-heading', '"a"; color: red'], ['--organic-font-heading', "'Arial', serif"], ['--organic-font-label', '14em'],
    ['--organic-font-label', '100px'], ['--organic-text', 'red'], ['--panel-theme-background', 'url(x)'],
    ['--panel-theme-background', 'linear-gradient(90deg, red 0%, blue 100%)'], ['--organic-space-1', '4px'], ['--z-system', '1'],
  ] as const) assert.equal(isPanelThemePropertyValue(name, value), false, `${name}: ${value}`)
})

test('gradient builder only emits host-shaped strings', () => {
  assert.equal(buildPanelThemeGradient({ type: 'gradient', kind: 'linear', angle: 160, stops: [{ color: 'rgb(1 2 3 / 1)', at: 0 }, { color: 'rgb(4 5 6 / 1)', at: 100 }] }),
    'linear-gradient(160deg, rgb(1 2 3 / 1) 0%, rgb(4 5 6 / 1) 100%)')
  assert.equal(buildPanelThemeGradient({ type: 'gradient', kind: 'linear', angle: 400, stops: [{ color: 'rgb(1 2 3 / 1)', at: 0 }, { color: 'rgb(4 5 6 / 1)', at: 100 }] }), null)
  assert.equal(buildPanelThemeGradient({ type: 'gradient', kind: 'linear', angle: 1, stops: [{ color: 'red', at: 0 }, { color: 'rgb(4 5 6 / 1)', at: 100 }] }), null)
  assert.equal(buildPanelThemeGradient({ type: 'solid' }), null)
})

test('diff writes only changed values and removes stale names', () => {
  const current = new Map([['--organic-bg', 'a'], ['--organic-text', 'b'], ['--organic-accent', 'c']])
  const next = new Map([['--organic-bg', 'a'], ['--organic-text', 'B'], ['--organic-font-label', '12px']])
  assert.deepEqual(diffPanelThemeProperties(current, next), { remove: ['--organic-accent'], set: [['--organic-text', 'B'], ['--organic-font-label', '12px']] })
})

test('one active theme per mode and settings navigation targets the owning plugin', () => {
  const ref = { pluginId: 'theme-pack', themeId: 'aurora' }
  const current = state({ light: { ref, status: 'active' }, dark: { ref, status: 'active' } })
  assert.deepEqual(activePanelThemeModes(current, ref), ['light', 'dark'])
  assert.deepEqual(activePanelThemeModes(current, { pluginId: 'theme-pack', themeId: 'other' }), [])
  assert.equal(panelThemeSettingsTarget(current), 'theme-pack')
  assert.equal(panelThemeSettingsTarget(state({ light: { ref: null, status: 'builtin' }, dark: { ref: null, status: 'builtin' } })), 'theme-pack')
  assert.equal(panelThemeSettingsTarget({ ...current, themes: [] }), null)
  assert.equal(panelThemeSettingsTarget(null), null)
})

test('the renderer applies themes with setProperty in one frame, never cssText or <style>', () => {
  const composable = readFileSync('src/composables/usePanelTheme.ts', 'utf8')
  assert.match(composable, /requestAnimationFrame/)
  assert.match(composable, /style\.setProperty\(name, value\)/)
  for (const file of ['src/composables/usePanelTheme.ts', 'src/components/PanelThemeBackdrop.vue', 'src/components/panel-theme/PanelThemePreview.vue', 'src/utils/panel-theme-css.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /cssText|innerHTML|v-html|createElement\('style'\)|insertRule/, file)
  }
})

test('protected regions and the theme controls keep the built-in palette', () => {
  for (const file of [
    'src/components/ui/InlinePermissionCard.vue', 'src/components/permission/PermissionOutcomeNotice.vue',
    'src/components/plugin-panel/PluginInstallSheet.vue', 'src/components/plugin-panel/PluginPanelFrame.vue',
    'src/components/ui/ConfirmDialog.vue', 'src/components/status-panel/ServerHealthBanner.vue',
    'src/components/status-panel/SettingsPanelTheme.vue', 'src/components/plugin-panel/PluginPanelThemes.vue',
  ]) assert.match(readFileSync(file, 'utf8'), /host-protected/, file)
  const tokens = readFileSync('src/styles/tokens.css', 'utf8')
  const protectedBlock = tokens.slice(tokens.indexOf('.host-protected {'), tokens.indexOf('}', tokens.indexOf('.host-protected {')))
  for (const property of PANEL_THEME_CSS_PROPERTIES.filter(name => name !== '--panel-theme-background')) {
    assert.match(protectedBlock, new RegExp(`${property}: var\\(--builtin${property.slice(1)}\\);`), property)
    assert.match(tokens, new RegExp(`^  ${property}: var\\(--builtin${property.slice(1)}\\);`, 'm'), `${property} aliases the frozen copy`)
  }
  assert.match(readFileSync('src/components/StatusPanel.css', 'utf8'), /\.status-panel,\n\.status-panel :deep\(\.host-protected\),\n:deep\(\.panel-theme-preview\) \{/)
  // The pet window is never themed: only the panel's StatusPanel uses the composable.
  assert.doesNotMatch(readFileSync('src/components/DesktopPet.vue', 'utf8'), /usePanelTheme/)
})
