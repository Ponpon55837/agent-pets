import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestValueCoalescer, createOrderedBatchCoalescer } from '../electron/ipc/broadcast-coalescer.ts'

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

test('latest-value coalescing preserves the final projection in 1,000 seeded event-loop batches', () => {
  const random = seededRandom(0x18_03_2026)
  for (let sample = 0; sample < 1_000; sample += 1) {
    const scheduled: Array<() => void> = []
    const delivered: number[] = []
    const enqueue = createLatestValueCoalescer(value => delivered.push(value), callback => scheduled.push(callback))
    const count = 1 + Math.floor(random() * 100)
    let expected = 0
    for (let index = 0; index < count; index += 1) {
      expected = Math.floor(random() * 10_000)
      enqueue(expected)
    }
    assert.equal(scheduled.length, 1, `scheduled callbacks for case ${sample}`)
    scheduled.shift()!()
    assert.deepEqual(delivered, [expected], `final projection for case ${sample}`)
  }
})

test('ordered batch coalescing preserves every event and original order in 1,000 seeded batches', () => {
  const random = seededRandom(0x18_03_2026)
  for (let sample = 0; sample < 1_000; sample += 1) {
    const scheduled: Array<() => void> = []
    const delivered: number[] = []
    const enqueue = createOrderedBatchCoalescer(values => delivered.push(...values), callback => scheduled.push(callback))
    const expected = Array.from({ length: 1 + Math.floor(random() * 100) }, () => Math.floor(random() * 10_000))
    expected.forEach(enqueue)
    assert.equal(scheduled.length, 1, `scheduled callbacks for case ${sample}`)
    scheduled.shift()!()
    assert.deepEqual(delivered, expected, `ordered batch for case ${sample}`)
  }
})

test('bounded ordered coalescer sheds non-priority items first and keeps terminal ones', () => {
  const scheduled: Array<() => void> = []
  const delivered: string[] = []
  const dropped: string[] = []
  const enqueue = createOrderedBatchCoalescer<string>(
    values => delivered.push(...values),
    callback => scheduled.push(callback),
    { maxPending: 3, isPriority: value => value.startsWith('!'), onDrop: value => dropped.push(value) },
  )
  for (const value of ['a', '!done', 'b', 'c', 'd', '!err']) enqueue(value)
  scheduled.shift()!()
  assert.deepEqual(delivered, ['!done', 'd', '!err'])
  assert.deepEqual(dropped, ['a', 'b', 'c'])
})

test('a full queue of priority items never drops the arriving non-priority item into the queue', () => {
  const scheduled: Array<() => void> = []
  const delivered: string[] = []
  const enqueue = createOrderedBatchCoalescer<string>(
    values => delivered.push(...values),
    callback => scheduled.push(callback),
    { maxPending: 2, isPriority: value => value.startsWith('!') },
  )
  for (const value of ['!1', '!2', 'x', '!3']) enqueue(value)
  scheduled.shift()!()
  assert.deepEqual(delivered, ['!2', '!3'])
})
