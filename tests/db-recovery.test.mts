import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openWithCorruptionRecovery } from '../electron/main/db-recovery.ts'

test('a database that fails to open is moved aside and recreated once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'history.sqlite')
  writeFileSync(file, 'garbage')
  let calls = 0
  const result = openWithCorruptionRecovery(file, () => {
    calls += 1
    if (existsSync(file)) throw new Error('corrupt')
    return 'fresh'
  }, { now: () => 42 })
  assert.equal(result, 'fresh')
  assert.equal(calls, 2)
  assert.ok(readdirSync(dir).includes('history.sqlite.corrupt-42'))
})

test('returns null when recovery cannot help and does not retry forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-db-'))
  const file = join(dir, 'missing.sqlite')
  let calls = 0
  const result = openWithCorruptionRecovery(file, () => { calls += 1; throw new Error('boom') })
  assert.equal(result, null)
  assert.equal(calls, 1)
})
