import assert from 'node:assert/strict'
import test from 'node:test'
import { readImageSize, validateSpriteSheet } from '../electron/pet-sprite-validation.ts'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function webpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f])
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  new DataView(bytes.buffer).setUint32(21, bits, true)
  return bytes
}

function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
  const w = width - 1
  const h = height - 1
  bytes.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24)
  bytes.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], 27)
  return bytes
}

test('reads dimensions from PNG and WebP headers', () => {
  assert.deepEqual(readImageSize(png(1536, 1872)), { width: 1536, height: 1872 })
  assert.deepEqual(readImageSize(webpLossless(1536, 1872)), { width: 1536, height: 1872 })
  assert.deepEqual(readImageSize(webpExtended(1536, 1872)), { width: 1536, height: 1872 })
  assert.equal(readImageSize(new Uint8Array([1, 2, 3])), null)
})

test('accepts a v2 atlas and rejects off-grid or short sheets with a code', () => {
  assert.equal(validateSpriteSheet(png(1536, 1872)).ok, true)
  assert.deepEqual(validateSpriteSheet(png(1000, 1872)), { ok: false, code: 'E_SIZE' })
  assert.deepEqual(validateSpriteSheet(png(1536, 208 * 4)), { ok: false, code: 'E_ROWS' })
  assert.deepEqual(validateSpriteSheet(new Uint8Array(8)), { ok: false, code: 'E_TYPE' })
})
