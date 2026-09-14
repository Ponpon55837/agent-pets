import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWindowsFullscreenDetector,
  isExternalFullscreenWindow,
  nativeWindowHandleToPointer,
  type WindowsFullscreenWindowSnapshot,
} from '../electron/windows-fullscreen-detector.ts'

function fullscreenSnapshot(
  overrides: Partial<WindowsFullscreenWindowSnapshot> = {},
): WindowsFullscreenWindowSnapshot {
  return {
    processId: 42,
    ownProcessId: 7,
    visible: true,
    minimized: false,
    cloaked: false,
    frameBounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
    monitorBounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
    style: 0,
    ...overrides,
  }
}

test('recognizes only a visible external borderless window covering its monitor', () => {
  assert.equal(isExternalFullscreenWindow(fullscreenSnapshot()), true)
  assert.equal(
    isExternalFullscreenWindow(fullscreenSnapshot({
      frameBounds: { left: 1, top: 0, right: 1920, bottom: 1079 },
    })),
    true,
  )
})

test('rejects maximized, owned, cloaked, minimized, child, or mismatched windows', () => {
  const rejected = [
    { style: 0x00c00000 },
    { style: 0x00040000 },
    { style: 0x40000000 },
    { processId: 7 },
    { visible: false },
    { minimized: true },
    { cloaked: true },
    { frameBounds: { left: 0, top: 0, right: 1918, bottom: 1080 } },
    { monitorBounds: { left: 0, top: 0, right: 1920, bottom: 0 } },
  ] satisfies Array<Partial<WindowsFullscreenWindowSnapshot>>

  for (const override of rejected) {
    assert.equal(isExternalFullscreenWindow(fullscreenSnapshot(override)), false)
  }
})

test('converts Electron native window handles to Koffi pointer values', () => {
  assert.equal(nativeWindowHandleToPointer(null), null)
  assert.equal(nativeWindowHandleToPointer(new Uint8Array()), null)
  assert.equal(
    nativeWindowHandleToPointer(new Uint8Array([0x78, 0x56, 0x34, 0x12])),
    0x12345678n,
  )
  assert.equal(
    nativeWindowHandleToPointer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])),
    0x0807060504030201n,
  )
})

test('keeps the detector unavailable on non-Windows platforms', () => {
  const detector = createWindowsFullscreenDetector(() => {}, 'linux')
  assert.equal(detector.available, false)
  assert.equal(detector.start(), false)
})
