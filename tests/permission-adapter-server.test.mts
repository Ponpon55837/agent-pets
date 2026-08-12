import test from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { PermissionBroker } from '../electron/permission-broker.ts'
import {
  createPermissionAdapterServer,
  mapOpenCodeDecision,
  PermissionAdapterRelay,
} from '../electron/permission-adapter-server.ts'

const TOKEN = 'a'.repeat(64)

async function withServer(
  run: (context: {
    broker: PermissionBroker
    relay: PermissionAdapterRelay
    post: (path: string, body: unknown, token?: string) => Promise<Response>
  }) => Promise<void>,
) {
  const relay = new PermissionAdapterRelay()
  const broker = new PermissionBroker({
    randomId: (() => {
      let id = 0
      return () => `generated-${++id}`
    })(),
  })
  broker.registerAdapter(relay.createPort('opencode-cli'))
  broker.registerAdapter(relay.createPort('opencode-desktop'))
  const server = createPermissionAdapterServer({
    token: TOKEN,
    broker,
    relay,
    randomId: (() => {
      let id = 100
      return () => `server-${++id}`
    })(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const post = (path: string, body: unknown, token = TOKEN) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-pets-permission-token': token,
    },
    body: JSON.stringify(body),
  })

  try {
    await run({ broker, relay, post })
  } finally {
    broker.shutdown()
    relay.shutdown()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function permission(overrides: Record<string, unknown> = {}) {
  return {
    source: 'opencode-cli',
    instanceId: 'plugin-1',
    permissionId: 'per-1',
    sessionId: 'ses-1',
    project: 'C:/work/agent-pets',
    permission: 'bash',
    title: 'Run a local command',
    patterns: ['git status'],
    ...overrides,
  }
}

test('permission adapter server requires its dedicated token', async () => {
  await withServer(async ({ post }) => {
    const response = await post('/v1/permission/request', permission(), 'wrong-token')
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  })
})

test('permission adapter server rejects browser origins even with a valid token', async () => {
  await withServer(async ({ post }) => {
    const originalFetch = globalThis.fetch
    const response = await originalFetch(
      (await post('/v1/permission/request', permission())).url,
      {
        method: 'POST',
        headers: {
          origin: 'https://attacker.invalid',
          'content-type': 'application/json',
          'x-agent-pets-permission-token': TOKEN,
        },
        body: JSON.stringify(permission({ permissionId: 'per-origin' })),
      },
    )
    assert.equal(response.status, 403)
  })
})

test('request, decision, and acknowledgement complete exactly once', async () => {
  await withServer(async ({ broker, post }) => {
    const created = await post('/v1/permission/request', {
      ...permission(),
      callbackUrl: 'http://attacker.invalid/callback',
      responseHandle: 'forged-handle',
    })
    assert.equal(created.status, 201)
    const receipt = await created.json() as { requestId: string }
    assert.equal(receipt.requestId, 'server-102')

    const requests = broker.listRequests()
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.adapterId, 'opencode-cli')
    assert.equal(requests[0]?.projectId, 'agent-pets')
    assert.equal(requests[0]?.risk, 'high')
    assert.equal(JSON.stringify(requests).includes('attacker.invalid'), false)
    assert.equal(JSON.stringify(requests).includes('forged-handle'), false)

    const deciding = broker.decide(receipt.requestId, 'allow_once', 'bubble')
    const decisionResponse = await post('/v1/permission/decision', permission())
    assert.equal(decisionResponse.status, 200)
    const decision = await decisionResponse.json() as { decisionId: string; decision: string }
    assert.equal(decision.decision, 'allow_once')

    const forgedResult = await post('/v1/permission/result', {
      ...permission(),
      decisionId: 'wrong-decision',
      result: 'delivered',
    })
    assert.equal(forgedResult.status, 409)

    const result = await post('/v1/permission/result', {
      ...permission(),
      decisionId: decision.decisionId,
      result: 'delivered',
    })
    assert.equal(result.status, 204)
    assert.deepEqual(await deciding, { ok: true, status: 'allowed' })

    const replay = await post('/v1/permission/result', {
      ...permission(),
      decisionId: decision.decisionId,
      result: 'delivered',
    })
    assert.equal(replay.status, 409)
  })
})

test('duplicate create is idempotent and external Agent resolution cancels delivery', async () => {
  await withServer(async ({ broker, post }) => {
    const first = await post('/v1/permission/request', permission())
    const firstReceipt = await first.json() as { requestId: string }
    const duplicate = await post('/v1/permission/request', permission())
    assert.equal(duplicate.status, 200)
    assert.deepEqual(await duplicate.json(), firstReceipt)

    const deciding = broker.decide(firstReceipt.requestId, 'deny', 'hotkey')
    const polled = await post('/v1/permission/decision', permission())
    assert.equal(polled.status, 200)

    const resolved = await post('/v1/permission/resolved', permission())
    assert.equal(resolved.status, 204)
    assert.deepEqual(await deciding, { ok: false, error: 'conflict', status: 'cancelled' })
    assert.equal(broker.getAuditRecords()[0]?.terminalReason, 'agent_resolved')
  })
})

test('OpenCode decisions never map to permanent allow', () => {
  assert.equal(mapOpenCodeDecision('allow_once'), 'once')
  assert.equal(mapOpenCodeDecision('deny'), 'reject')
})
