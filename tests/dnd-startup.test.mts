import assert from 'node:assert/strict'
import test from 'node:test'
import { isDesktopEffectActive } from '../src/utils/desktop-effects.ts'

test('desktop effects fail closed until main-process preferences are ready', () => {
  assert.equal(isDesktopEffectActive(false, false, true), false)
  assert.equal(isDesktopEffectActive(true, false, true), true)
  assert.equal(isDesktopEffectActive(true, true, true), false)
  assert.equal(isDesktopEffectActive(true, false, false), false)
})
