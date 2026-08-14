import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAgentStatusEvent } from '../electron/event-normalizer.ts'
import { GENERIC_HTTP_CAPABILITIES } from '../src/types/capabilities.ts'

test('generic HTTP capabilities cannot respond to permissions', () => {
  assert.equal(GENERIC_HTTP_CAPABILITIES.permissions, 'none')
  assert.deepEqual(GENERIC_HTTP_CAPABILITIES.permissionModes, [])
})

test('normalizes a waiting permission event into an external-only notice', () => {
  const result = normalizeAgentStatusEvent({
    source: 'opencode',
    sessionId: 'session-1',
    project: 'C:\\work\\safe-project',
    state: 'waiting',
    originalEvent: 'PermissionRequest',
    timestamp: 1,
  }, 42)

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.event, {
    source: 'opencode-cli',
    sessionId: 'session-1',
    project: 'safe-project',
    state: 'waiting-permission',
    originalEvent: 'PermissionRequest',
    timestamp: 42,
    permissionNotice: { responseMode: 'external_only' },
  })
})

test('drops callback, command, pipe, port, and forged response metadata', () => {
  const result = normalizeAgentStatusEvent({
    source: 'claude',
    sessionId: 'session-2',
    state: 'waiting-permission',
    timestamp: 1,
    callbackUrl: 'http://127.0.0.1:9999/approve',
    command: 'dangerous-command',
    pipe: '\\\\.\\pipe\\agent-pets-test',
    port: 9999,
    responseHandle: 'forged',
    projectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    routedPetId: 'attacker-pet',
    permissionNotice: { responseMode: 'respond' },
  }, 100)

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(Object.keys(result.event).sort(), [
    'permissionNotice',
    'sessionId',
    'source',
    'state',
    'timestamp',
  ])
  assert.deepEqual(result.event.permissionNotice, { responseMode: 'external_only' })
})

test('rejects malformed generic events before projection', () => {
  assert.deepEqual(
    normalizeAgentStatusEvent({ source: 'unknown', sessionId: 'x', state: 'thinking', timestamp: 1 }),
    { ok: false, error: 'invalid source' },
  )
  assert.deepEqual(
    normalizeAgentStatusEvent({ source: 'codex', sessionId: '', state: 'thinking', timestamp: 1 }),
    { ok: false, error: 'invalid sessionId' },
  )
})
