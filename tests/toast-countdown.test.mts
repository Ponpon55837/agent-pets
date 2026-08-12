import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_NOTIFICATION_DURATION_MS,
  createToastCountdown,
  getToastRemainingMs,
} from '../src/utils/toast-countdown.ts'

test('success and error notifications receive the shared three-second countdown', () => {
  const success = createToastCountdown('success', 1_000)
  const error = createToastCountdown('error', 2_000)

  assert.deepEqual(success, {
    startedAt: 1_000,
    expiresAt: 1_000 + APP_NOTIFICATION_DURATION_MS,
    durationMs: APP_NOTIFICATION_DURATION_MS,
  })
  assert.deepEqual(error, {
    startedAt: 2_000,
    expiresAt: 2_000 + APP_NOTIFICATION_DURATION_MS,
    durationMs: APP_NOTIFICATION_DURATION_MS,
  })
})

test('permission notices and activity bubbles never receive an auto-dismiss countdown', () => {
  assert.equal(createToastCountdown('permission-notice', 1_000), null)
  assert.equal(createToastCountdown('activity', 1_000), null)
})

test('remaining time is bounded to the countdown window', () => {
  const countdown = createToastCountdown('success', 10_000)
  assert.ok(countdown)

  assert.equal(getToastRemainingMs(countdown, 9_000), APP_NOTIFICATION_DURATION_MS)
  assert.equal(getToastRemainingMs(countdown, 11_250), 1_750)
  assert.equal(getToastRemainingMs(countdown, 13_000), 0)
  assert.equal(getToastRemainingMs(countdown, 20_000), 0)
})
