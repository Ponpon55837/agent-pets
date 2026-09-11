import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopVisibilityCapabilitiesForPlatform } from '../electron/desktop-visibility.ts'

test('platform capability projection is explicit about Windows and macOS limits', () => {
  assert.deepEqual(
    desktopVisibilityCapabilitiesForPlatform('win32', true),
    {
      captureExclusion: { supported: true, mode: 'system' },
      fullscreenAutoHide: { supported: false, mode: 'unsupported' },
    },
  )
  assert.deepEqual(
    desktopVisibilityCapabilitiesForPlatform('darwin', true),
    {
      captureExclusion: { supported: true, mode: 'limited' },
      fullscreenAutoHide: { supported: true, mode: 'macos-native' },
    },
  )
  assert.equal(
    desktopVisibilityCapabilitiesForPlatform('linux', true).fullscreenAutoHide.supported,
    false,
  )
})
