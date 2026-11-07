import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { installChildProcessGoneLogger, installCrashGuard, runStartupStep } from '../electron/main/crash-guard.ts'

function fakeProcess() {
  return new EventEmitter() as EventEmitter & { off: EventEmitter['off'] }
}

test('installs handlers, logs without throwing, and throttles the user notice', () => {
  const proc = fakeProcess()
  const logs: string[] = []
  let notices = 0
  let clock = 0
  const guard = installCrashGuard({
    proc: proc as never,
    log: (_l, m) => logs.push(m),
    onUserVisibleError: () => { notices += 1 },
    now: () => clock,
  })
  assert.equal(proc.listenerCount('uncaughtException'), 1)
  assert.equal(proc.listenerCount('unhandledRejection'), 1)
  proc.emit('uncaughtException', new Error('boom'))
  proc.emit('unhandledRejection', 'bad')
  assert.equal(logs.length, 2)
  assert.equal(notices, 1)
  clock = 61_000
  proc.emit('unhandledRejection', new Error('again'))
  assert.equal(notices, 2)
  guard.dispose()
  assert.equal(proc.listenerCount('uncaughtException'), 0)
})

test('repeated identical errors are deduplicated and rate limited', () => {
  const proc = fakeProcess()
  const logs: string[] = []
  const guard = installCrashGuard({ proc: proc as never, log: (_l, m) => logs.push(m), now: () => 0, maxLogsPerWindow: 5 })
  for (let i = 0; i < 1000; i += 1) proc.emit('unhandledRejection', new Error('loop'))
  assert.ok(logs.length <= 12, `logged ${logs.length}`)
  assert.ok(guard.stats().suppressed > 900)
  for (let i = 0; i < 50; i += 1) proc.emit('uncaughtException', new Error(`distinct ${i}`))
  assert.ok(logs.length <= 5)
})

test('a throwing log sink or notifier never escapes the handler', () => {
  const proc = fakeProcess()
  installCrashGuard({
    proc: proc as never,
    log: () => { throw new Error('sink') },
    onUserVisibleError: () => { throw new Error('toast') },
  })
  assert.doesNotThrow(() => proc.emit('uncaughtException', new Error('x')))
})

test('startup steps are isolated from each other', async () => {
  const results: Array<{ name: string; ok: boolean }> = []
  const logs: string[] = []
  const log = (_l: string, m: string) => logs.push(m)
  const ran: string[] = []
  await runStartupStep('a', () => { throw new Error('nope') }, log as never, results)
  await runStartupStep('b', async () => { ran.push('b') }, log as never, results)
  assert.deepEqual(results.map(r => r.ok), [false, true])
  assert.deepEqual(ran, ['b'])
  assert.match(logs[0], /startup step "a" failed/)
})

test('child-process-gone is logged', () => {
  const app = new EventEmitter()
  const logs: string[] = []
  installChildProcessGoneLogger(app, (_l, m) => logs.push(m))
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 9 })
  assert.match(logs[0], /type=GPU reason=crashed/)
})
