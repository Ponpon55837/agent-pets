import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventRateLimiter } from '../electron/event-rate-limit.ts'

test('a runaway session cannot starve other sessions or terminal events', () => {
  let clock = 0
  const limiter = createEventRateLimiter({ now: () => clock, perSessionLimit: 3, terminalPerSessionLimit: 2 })
  const results = [1, 2, 3, 4].map(() => limiter.allowEvent('codex:loop', false))
  assert.deepEqual(results, [true, true, true, false])
  assert.equal(limiter.allowEvent('codex:other', false), true)
  assert.equal(limiter.allowEvent('codex:loop', true), true)
  assert.equal(limiter.allowEvent('codex:loop', true), true)
  assert.equal(limiter.allowEvent('codex:loop', true), false)
  clock = 10_001
  assert.equal(limiter.allowEvent('codex:loop', false), true)
})

test('global request ceiling resets each window', () => {
  let clock = 0
  const limiter = createEventRateLimiter({ now: () => clock, globalLimit: 2 })
  assert.deepEqual([limiter.allowRequest(), limiter.allowRequest(), limiter.allowRequest()], [true, true, false])
  clock = 10_000
  assert.equal(limiter.allowRequest(), true)
})
