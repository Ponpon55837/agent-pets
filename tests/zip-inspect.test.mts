import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync, type Zippable } from 'fflate'
import { inspectZipArchive, type ZipInspectLimits } from '../electron/zip-inspect.ts'

const LIMITS: ZipInspectLimits = {
  maxEntries: 8,
  maxTotalUncompressedBytes: 4 * 1024 * 1024,
  maxCompressionRatio: 100,
  ratioCheckMinBytes: 1024 * 1024,
}

const text = (value: string) => new TextEncoder().encode(value)

function zip(files: Zippable): Uint8Array {
  return zipSync(files, { level: 0 })
}

/** Offsets of every central-directory record in an archive. */
function centralRecords(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offsets: number[] = []
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) offsets.push(offset)
  }
  return offsets
}

function patch(bytes: Uint8Array, mutate: (view: DataView, records: number[]) => void): Uint8Array {
  const copy = bytes.slice()
  mutate(new DataView(copy.buffer), centralRecords(copy))
  return copy
}

test('accepts an ordinary sprite kit and lists its entries', () => {
  const result = inspectZipArchive(zip({ 'kit/pet.json': text('{"id":"a"}'), 'kit/spritesheet.webp': new Uint8Array(64) }), LIMITS)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.entries.map(entry => entry.name).sort(), ['kit/pet.json', 'kit/spritesheet.webp'])
  assert.equal(result.totalUncompressedBytes, 74)
})

test('rejects garbage, truncated and ZIP64 archives', () => {
  assert.deepEqual(inspectZipArchive(new Uint8Array(10), LIMITS), { ok: false, error: 'invalid_archive' })
  assert.deepEqual(inspectZipArchive(text('not a zip archive at all, just text padding'), LIMITS), { ok: false, error: 'invalid_archive' })
  const valid = zip({ 'pet.json': text('{}') })
  const zip64 = valid.slice()
  const eocd = zip64.length - 22
  new DataView(zip64.buffer).setUint32(eocd + 16, 0xffffffff, true)
  assert.deepEqual(inspectZipArchive(zip64, LIMITS), { ok: false, error: 'unsupported_archive' })
})

test('rejects symlink, reparse-point and encrypted entries', () => {
  const base = zip({ 'pet.json': text('{}'), 'link.png': text('../../etc/passwd') })
  const symlink = patch(base, (view, records) => {
    view.setUint8(records[1] + 5, 3)
    view.setUint32(records[1] + 38, (0o120777 << 16) >>> 0, true)
  })
  assert.deepEqual(inspectZipArchive(symlink, LIMITS), { ok: false, error: 'symlink_entry' })
  const reparse = patch(base, (view, records) => {
    view.setUint8(records[1] + 5, 0)
    view.setUint32(records[1] + 38, 0x400, true)
  })
  assert.deepEqual(inspectZipArchive(reparse, LIMITS), { ok: false, error: 'symlink_entry' })
  const encrypted = patch(base, (view, records) => view.setUint16(records[0] + 8, 1, true))
  assert.deepEqual(inspectZipArchive(encrypted, LIMITS), { ok: false, error: 'encrypted_entry' })
})

test('rejects zip-slip names, non-UTF-8 names and case-insensitive duplicates', () => {
  for (const name of ['../pet.json', '/abs/pet.json', 'C:/pet.json', 'a/../../pet.json']) {
    // fflate writes the name as given, so the archive itself carries the hostile path.
    assert.deepEqual(inspectZipArchive(zip({ [name]: text('{}') }), LIMITS), { ok: false, error: 'unsafe_path' }, name)
  }
  const nonUtf8 = patch(zip({ 'pet.json': text('{}'), 'abcd.png': text('x') }), (view, records) => {
    view.setUint8(records[1] + 46, 0xff)
  })
  assert.deepEqual(inspectZipArchive(nonUtf8, LIMITS), { ok: false, error: 'invalid_name' })
  const duplicate = patch(zip({ 'pet.json': text('{}'), 'PET.JSON': text('{"x":1}') }), () => undefined)
  assert.deepEqual(inspectZipArchive(duplicate, LIMITS), { ok: false, error: 'duplicate_path' })
  const control = zip({ 'pet\u0001.json': text('{}') })
  assert.deepEqual(inspectZipArchive(control, LIMITS), { ok: false, error: 'invalid_name' })
})

test('accepts UTF-8 names written without the language-encoding flag (macOS Archive Utility)', () => {
  const archive = patch(zip({ '寵物/pet.json': text('{}') }), (view, records) => {
    view.setUint16(records[0] + 8, view.getUint16(records[0] + 8, true) & ~0x800, true)
  })
  const result = inspectZipArchive(archive, LIMITS)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.entries[0].name, '寵物/pet.json')
    assert.notEqual(result.entries[0].archiveName, result.entries[0].name)
  }
})

test('enforces entry count, total size and compression-ratio limits before inflating', () => {
  const many: Zippable = {}
  for (let index = 0; index < 9; index += 1) many[`f${index}.png`] = text('x')
  assert.deepEqual(inspectZipArchive(zip(many), LIMITS), { ok: false, error: 'file_limit_exceeded' })

  const bomb = zipSync({ 'zeros.png': new Uint8Array(3 * 1024 * 1024) }, { level: 9 })
  assert.deepEqual(inspectZipArchive(bomb, LIMITS), { ok: false, error: 'compression_ratio_exceeded' })

  const huge = patch(zip({ 'pet.json': text('{}') }), (view, records) => {
    view.setUint32(records[0] + 20, 1, true)
    view.setUint32(records[0] + 24, 64 * 1024 * 1024, true)
  })
  const result = inspectZipArchive(huge, LIMITS)
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(['total_size_exceeded', 'invalid_archive', 'compression_ratio_exceeded'].includes(result.error))
})

test('rejects entries whose data ranges overlap (overlapping-file zip bomb)', () => {
  const archive = patch(zip({ 'a.png': text('aaaa'), 'b.png': text('bbbb') }), (view, records) => {
    view.setUint32(records[1] + 42, view.getUint32(records[0] + 42, true), true)
  })
  // Both records now point at the same local header; the second name no longer matches it,
  // but the shared range is what must be refused.
  const result = inspectZipArchive(archive, LIMITS)
  assert.deepEqual(result, { ok: false, error: 'overlapping_entries' })
})
