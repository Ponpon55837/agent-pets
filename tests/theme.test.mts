import test from 'node:test'
import assert from 'node:assert/strict'
import { isThemePreference, resolveTheme } from '../src/composables/useTheme.ts'

test('system preference follows the OS, explicit preferences win', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

test('only known preferences are accepted', () => {
  assert.ok(isThemePreference('system') && isThemePreference('light') && isThemePreference('dark'))
  assert.ok(!isThemePreference('sepia') && !isThemePreference(null))
})
