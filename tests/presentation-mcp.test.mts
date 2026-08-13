import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'
import {
  createPresentationMcpServer,
  PRESENTATION_CLIENT_HEADER,
  PRESENTATION_TOKEN_HEADER,
} from '../electron/presentation-mcp.ts'
import { PresentationController } from '../electron/presentation-controller.ts'

function startServer(t: test.TestContext) {
  const controller = new PresentationController({
    emit: () => {},
    getStatus: () => ({ activePets: [], dnd: false, enabled: true }),
    getBlockReason: () => null,
    createId: () => 'intent-test-1234',
  })
  const server = createPresentationMcpServer({ token: 'a'.repeat(64), controller })
  t.after(() => server.close())
  return new Promise<{ port: number; controller: PresentationController }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('server did not bind'))
      resolve({ port: address.port, controller })
    })
  })
}

function call(port: number, options: {
  method: string
  path: string
  token?: string
  client?: string
  origin?: string
  body?: unknown
}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const serialized = options.body === undefined ? '' : JSON.stringify(options.body)
    const req = request({
      hostname: '127.0.0.1',
      port,
      method: options.method,
      path: options.path,
      headers: {
        ...(options.token ? { [PRESENTATION_TOKEN_HEADER]: options.token } : {}),
        ...(options.client ? { [PRESENTATION_CLIENT_HEADER]: options.client } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(serialized ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(serialized),
        } : {}),
      },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: response.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} })
      })
    })
    req.on('error', reject)
    if (serialized) req.write(serialized)
    req.end()
  })
}

test('presentation MCP is token-authenticated and browser-origin resistant', async t => {
  const { port } = await startServer(t)
  const token = 'a'.repeat(64)
  assert.equal((await call(port, { method: 'GET', path: '/v1/presentation/status' })).status, 401)
  assert.equal((await call(port, { method: 'GET', path: '/v1/presentation/status', token, origin: 'https://evil.test' })).status, 403)
  const status = await call(port, { method: 'GET', path: '/v1/presentation/status', token })
  assert.equal(status.status, 200)
  assert.equal(status.body.queueDepth, 0)
})

test('presentation MCP exposes only bounded intent routes and disconnect cleanup', async t => {
  const { port, controller } = await startServer(t)
  const token = 'a'.repeat(64)
  const client = 'client-mcp-1234'
  const badMethod = await call(port, {
    method: 'POST',
    path: '/v1/presentation/status',
    token,
    body: {},
  })
  assert.equal(badMethod.status, 405)
  const intent = await call(port, {
    method: 'POST',
    path: '/v1/presentation/intents',
    token,
    client,
    body: { kind: 'say', message: '<b>Hello</b>', ttlMs: 1_000 },
  })
  assert.equal(intent.status, 200)
  assert.equal(intent.body.accepted, true)
  assert.equal(controller.getQueueDepth(), 1)
  const disconnected = await call(port, {
    method: 'POST',
    path: '/v1/presentation/disconnect',
    token,
    client,
    body: {},
  })
  assert.deepEqual(disconnected.body, { removed: 1 })
  assert.equal(controller.getQueueDepth(), 0)
  const commandRoute = await call(port, {
    method: 'POST',
    path: '/v1/presentation/execute',
    token,
    client,
    body: { command: 'whoami' },
  })
  assert.equal(commandRoute.status, 404)
})
