import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateTerminalNotifications,
  classifyNotification,
  NotificationCooldown,
} from '../electron/notification-policy.ts'

function event(state: string, overrides: Record<string, unknown> = {}) {
  return {
    source: 'codex',
    sessionId: 'session-1',
    project: 'agent-pets',
    state,
    timestamp: Date.now(),
    ...overrides,
  }
}

test('classifies waiting and terminal events without exposing tool data', () => {
  const waiting = classifyNotification(event('waiting-permission', {
    toolName: 'secret command',
  }) as any)
  assert.equal(waiting?.kind, 'waiting-permission')
  assert.equal(waiting?.title, 'Codex 需要 Permission')
  assert.equal(waiting?.body, 'agent-pets')
  assert.doesNotMatch(`${waiting?.title} ${waiting?.body}`, /secret command/)

  const success = classifyNotification(event('success') as any)
  assert.equal(success?.terminal, true)
  assert.equal(classifyNotification(event('thinking') as any), null)
})

test('suppresses integration-test notifications', () => {
  assert.equal(classifyNotification(event('success', {
    originalEvent: 'AgentPetsIntegrationTest',
  }) as any), null)
})

test('cooldown rejects duplicate session and event class within the window', () => {
  const cooldown = new NotificationCooldown(60_000)
  assert.equal(cooldown.take('codex:session-1:success', 1_000), true)
  assert.equal(cooldown.take('codex:session-1:success', 2_000), false)
  assert.equal(cooldown.take('codex:session-1:error', 2_000), true)
  assert.equal(cooldown.take('codex:session-1:success', 61_000), true)
})

test('aggregates terminal notifications without project or session details', () => {
  const candidates = [
    classifyNotification(event('success') as any),
    classifyNotification(event('error', { sessionId: 'session-2' }) as any),
  ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)

  assert.deepEqual(aggregateTerminalNotifications(candidates), {
    title: '2 個 Agent 工作已完成',
    body: '1 個已完成 · 1 個失敗',
  })
})
