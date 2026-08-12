import assert from 'node:assert/strict'
import test from 'node:test'
import { createAttentionBitmap } from '../electron/tray-icon.ts'

test('attention badge changes a bounded top-right region without mutating source', () => {
  const width = 16
  const height = 16
  const source = Buffer.alloc(width * height * 4, 0)
  const result = createAttentionBitmap(source, width, height)

  assert.notStrictEqual(result, source)
  assert.equal(source.every(byte => byte === 0), true)
  assert.equal(result.length, source.length)

  let changedPixels = 0
  for (let offset = 0; offset < result.length; offset += 4) {
    if (result[offset + 3] !== 0) changedPixels += 1
  }
  assert.ok(changedPixels >= 20 && changedPixels <= 40)
  assert.equal(result[((3 * width) + 13) * 4 + 3], 255)
  assert.equal(result[((12 * width) + 3) * 4 + 3], 0)
})

test('attention badge rejects invalid bitmap dimensions', () => {
  assert.throws(() => createAttentionBitmap(Buffer.alloc(4), 1, 1), /at least 8 px/)
  assert.throws(() => createAttentionBitmap(Buffer.alloc(16), 8, 8), /byte length/)
})
