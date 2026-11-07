import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRunLocalUsageTick } from '../electron/main/scan-schedule.ts'

test('local usage scan runs every tick on AC and every fifth tick on battery', () => {
  assert.deepEqual([1, 2, 3].map(tick => shouldRunLocalUsageTick(tick, false)), [true, true, true])
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(tick => shouldRunLocalUsageTick(tick, true)), [false, false, false, false, true, true])
})
