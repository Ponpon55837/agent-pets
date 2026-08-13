import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('stdio presentation bridge speaks MCP and disconnects its client', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-presentation-'))
  const deploy = path.join(home, '.desktop-pet')
  fs.mkdirSync(deploy, { recursive: true })
  fs.writeFileSync(path.join(deploy, 'presentation-token'), `${'b'.repeat(64)}\n`)

  const requests: Array<{ path?: string; client?: string }> = []
  const server = http.createServer((request, response) => {
    requests.push({
      path: request.url,
      client: typeof request.headers['x-agent-pets-client'] === 'string'
        ? request.headers['x-agent-pets-client']
        : undefined,
    })
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      if (request.url === '/v1/presentation/status') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ activePets: [], dnd: false, enabled: true, queueDepth: 0 }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ accepted: true, id: 'stdio-intent-1234', queued: 1, expiresAt: Date.now() + 1_000 }))
    })
  })
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    server.close()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port

  const child = spawn('node.exe', ['integrations/presentation-mcp.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      AGENT_PETS_PRESENTATION_PORT: String(port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => {
    if (!child.killed) child.kill()
  })

  let output = ''
  const lines: any[] = []
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    output += chunk
    let newline = output.indexOf('\n')
    while (newline >= 0) {
      const line = output.slice(0, newline).trim()
      output = output.slice(newline + 1)
      if (line) lines.push(JSON.parse(line))
      newline = output.indexOf('\n')
    }
  })

  const waitForId = async (id: number): Promise<any> => {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      const result = lines.find(message => message.id === id)
      if (result) return result
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`Timed out waiting for MCP response ${id}`)
  }

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
  const initialized = await waitForId(1)
  assert.equal(initialized.result.serverInfo.name, 'agent-pets-presentation')
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
  const listed = await waitForId(2)
  assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), ['pet_status', 'pet_react', 'pet_say'])
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pet_status', arguments: {} } })}\n`)
  const status = await waitForId(3)
  assert.equal(status.result.structuredContent.enabled, true)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'pet_react', arguments: { reaction: 'happy' } } })}\n`)
  const called = await waitForId(4)
  assert.equal(called.result.structuredContent.accepted, true)
  child.stdin.end()

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stdio bridge did not exit')), 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  assert.ok(requests.some(request => request.path === '/v1/presentation/status'))
  assert.ok(requests.some(request => request.path === '/v1/presentation/intents'))
  assert.ok(requests.some(request => request.path === '/v1/presentation/disconnect'))
  assert.ok(requests.every(request => request.client && /^[a-f0-9]{32}$/.test(request.client)))
})
