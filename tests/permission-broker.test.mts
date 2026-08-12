import test from 'node:test'
import assert from 'node:assert/strict'
import { PermissionBroker } from '../electron/permission-broker.ts'

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    generation: 1,
    action: 'Run a tool',
    description: 'The agent needs a one-time decision.',
    risk: 'low' as const,
    responseHandle: { secret: 'opaque-handle' },
    ...overrides,
  }
}

function respondPort(
  respond: (
    handle: unknown,
    decision: unknown,
    signal: AbortSignal,
  ) => Promise<'delivered' | 'already_resolved' | 'rejected'>,
) {
  return {
    id: 'opencode-desktop',
    capabilities: {
      permissions: 'respond' as const,
      permissionModes: ['allow_once', 'deny'] as const,
    },
    respond,
  }
}

test('observe-only adapters cannot create broker requests', () => {
  const broker = new PermissionBroker()
  broker.registerAdapter({
    id: 'generic-http',
    capabilities: { permissions: 'none', permissionModes: [] },
    async respond() { return 'rejected' as const },
  })

  assert.deepEqual(
    broker.createRequest('generic-http', request()),
    { ok: false, error: 'capability_denied' },
  )
})

test('adapter registration rejects unsupported or contradictory capability modes', () => {
  const broker = new PermissionBroker()
  assert.throws(() => broker.registerAdapter({
    id: 'unsafe-adapter',
    capabilities: {
      permissions: 'respond',
      permissionModes: ['always'],
    },
    async respond() { return 'delivered' as const },
  } as never), /capability modes/)
  assert.throws(() => broker.registerAdapter({
    id: 'observe-with-response',
    capabilities: {
      permissions: 'observe',
      permissionModes: ['deny'],
    },
    async respond() { return 'rejected' as const },
  }), /capability modes/)
})

test('malformed runtime input fails closed instead of throwing', () => {
  const broker = new PermissionBroker()
  broker.registerAdapter(respondPort(async () => 'delivered'))

  assert.deepEqual(
    broker.createRequest('opencode-desktop', null),
    { ok: false, error: 'invalid_request' },
  )
  assert.deepEqual(
    broker.createRequest('opencode-desktop', request({ allowedDecisions: 'allow_once' })),
    { ok: false, error: 'invalid_request' },
  )
  assert.deepEqual(
    broker.createRequest('opencode-desktop', request({ allowedDecisions: ['allow_once', 'always'] })),
    { ok: false, error: 'invalid_request' },
  )
})

test('request record capacity fails closed and preserves replay protection', async () => {
  const broker = new PermissionBroker({ maxRequestRecords: 1 })
  broker.registerAdapter(respondPort(async () => 'delivered'))
  assert.equal(broker.createRequest('opencode-desktop', request()).ok, true)
  await broker.decide('request-1', 'deny', 'bubble')

  assert.deepEqual(
    broker.createRequest('opencode-desktop', request({ requestId: 'request-2' })),
    { ok: false, error: 'capacity_exceeded' },
  )
  assert.deepEqual(
    broker.createRequest('opencode-desktop', request()),
    { ok: false, error: 'duplicate_request' },
  )
})

test('request views are sanitized and never expose the response handle', () => {
  const broker = new PermissionBroker({ now: () => 1_000 })
  broker.registerAdapter(respondPort(async () => 'delivered'))
  const created = broker.createRequest('opencode-desktop', request({
    action: `Run\u0000 ${'x'.repeat(100)}`,
    description: `Sensitive\n${'y'.repeat(320)}`,
    risk: 'high',
  }))

  assert.equal(created.ok, true)
  if (!created.ok) return
  assert.equal(created.request.action.includes('\u0000'), false)
  assert.equal(created.request.action.length, 80)
  assert.equal(created.request.description.length, 280)
  assert.equal(created.request.truncated, true)
  assert.equal(created.request.hotkeyEligible, false)
  assert.equal(JSON.stringify(created.request).includes('opaque-handle'), false)
})

test('concurrent decisions dispatch exactly once and block replay', async () => {
  let release!: (value: 'delivered') => void
  const delivery = new Promise<'delivered'>((resolve) => { release = resolve })
  let dispatches = 0
  const broker = new PermissionBroker({
    now: () => 2_000,
    randomId: (() => { let id = 0; return () => `id-${++id}` })(),
  })
  broker.registerAdapter(respondPort(async () => {
    dispatches += 1
    return delivery
  }))
  assert.equal(broker.createRequest('opencode-desktop', request()).ok, true)

  const first = broker.decide('request-1', 'allow_once', 'bubble')
  const second = await broker.decide('request-1', 'deny', 'hotkey')
  assert.deepEqual(second, { ok: false, error: 'conflict', status: 'deciding' })
  assert.equal(dispatches, 1)

  release('delivered')
  assert.deepEqual(await first, { ok: true, status: 'allowed' })
  assert.deepEqual(
    await broker.decide('request-1', 'allow_once', 'bubble'),
    { ok: false, error: 'conflict', status: 'allowed' },
  )
  assert.equal(dispatches, 1)
  assert.deepEqual(
    broker.createRequest('opencode-desktop', request()),
    { ok: false, error: 'duplicate_request' },
  )
})

test('TTL expiry fails closed without dispatch', async () => {
  let now = 5_000
  let dispatches = 0
  const broker = new PermissionBroker({ now: () => now })
  broker.registerAdapter(respondPort(async () => { dispatches += 1; return 'delivered' }))
  assert.equal(broker.createRequest('opencode-desktop', request({ ttlMs: 15_000 })).ok, true)

  now = 20_000
  assert.deepEqual(
    await broker.decide('request-1', 'allow_once', 'bubble'),
    { ok: false, error: 'conflict', status: 'expired' },
  )
  assert.equal(dispatches, 0)
  assert.equal(broker.getAuditRecords()[0]?.terminalReason, 'ttl')
})

test('listing requests never returns expired permission views', () => {
  let now = 5_000
  const broker = new PermissionBroker({ now: () => now })
  broker.registerAdapter(respondPort(async () => 'delivered'))
  assert.equal(broker.createRequest('opencode-desktop', request({ ttlMs: 15_000 })).ok, true)

  now = 20_000
  assert.deepEqual(broker.listRequests(), [])
  assert.equal(broker.getAuditRecords()[0]?.status, 'expired')
})

test('external resolution aborts an in-flight adapter response', async () => {
  let observedSignal: AbortSignal | undefined
  let attachAbort!: (signal: AbortSignal) => void
  const delivery = new Promise<'delivered'>((_resolve, reject) => {
    attachAbort = (signal: AbortSignal) => {
      observedSignal = signal
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }
  })
  const broker = new PermissionBroker({ now: () => 8_000 })
  broker.registerAdapter(respondPort(async (_handle, _decision, signal) => {
    attachAbort(signal)
    return delivery
  }))
  broker.createRequest('opencode-desktop', request())

  const deciding = broker.decide('request-1', 'deny', 'hotkey')
  assert.equal(broker.resolveExternally('request-1', 'agent_resolved'), true)
  assert.equal(observedSignal?.aborted, true)
  assert.deepEqual(
    await deciding,
    { ok: false, error: 'conflict', status: 'cancelled' },
  )
  assert.equal(broker.getAuditRecords().length, 1)
  assert.equal(broker.getAuditRecords()[0]?.terminalReason, 'agent_resolved')
})

test('restart does not restore an old response handle or pending decision', async () => {
  const oldBroker = new PermissionBroker()
  oldBroker.registerAdapter(respondPort(async () => 'delivered'))
  oldBroker.createRequest('opencode-desktop', request())
  oldBroker.shutdown()
  assert.equal(oldBroker.getAuditRecords()[0]?.terminalReason, 'broker_shutdown')

  const restartedBroker = new PermissionBroker()
  restartedBroker.registerAdapter(respondPort(async () => 'delivered'))
  assert.deepEqual(
    await restartedBroker.decide('request-1', 'allow_once', 'bubble'),
    { ok: false, error: 'not_found' },
  )
})

test('audit records omit action, description, and response handles', async () => {
  const broker = new PermissionBroker({ now: () => 9_000 })
  broker.registerAdapter(respondPort(async () => 'delivered'))
  broker.createRequest('opencode-desktop', request({
    action: 'secret action',
    description: 'secret description',
    responseHandle: 'secret response handle',
  }))
  await broker.decide('request-1', 'deny', 'bubble')

  const serialized = JSON.stringify(broker.getAuditRecords())
  assert.equal(serialized.includes('secret action'), false)
  assert.equal(serialized.includes('secret description'), false)
  assert.equal(serialized.includes('secret response handle'), false)
})
