import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const configuredPort = Number.parseInt(process.env.AGENT_PETS_PRESENTATION_PORT ?? '', 10)
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
  ? configuredPort
  : 17375
const TOKEN_PATH = path.join(os.homedir(), '.desktop-pet', 'presentation-token')
const TOKEN_HEADER = 'x-agent-pets-presentation-token'
const CLIENT_HEADER = 'x-agent-pets-client'
const PROTOCOL_VERSION = '2024-11-05'
const clientId = crypto.randomBytes(16).toString('hex')
let disconnectSent = false

function readToken() {
  try {
    const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
    return /^[a-f0-9]{64}$/i.test(token) ? token : ''
  } catch {
    return ''
  }
}

function requestJson(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const token = readToken()
    if (!token) {
      reject(new Error('Agent Pets presentation token is unavailable'))
      return
    }
    const serialized = body === undefined ? '' : JSON.stringify(body)
    const request = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathname,
      method,
      headers: {
        [TOKEN_HEADER]: token,
        [CLIENT_HEADER]: clientId,
        ...(serialized ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(serialized),
        } : {}),
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed = {}
        try { parsed = raw ? JSON.parse(raw) : {} } catch {}
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          const error = new Error(typeof parsed.error === 'string' ? parsed.error : `Agent Pets returned ${response.statusCode}`)
          error.code = response.statusCode
          reject(error)
          return
        }
        resolve(parsed)
      })
    })
    request.setTimeout(1_500, () => request.destroy(new Error('Agent Pets presentation request timed out')))
    request.on('error', reject)
    if (serialized) request.write(serialized)
    request.end()
  })
}

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  }
}

const tools = [
  {
    name: 'pet_status',
    description: 'Read the current local Agent Pets presentation status. This is read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pet_react',
    description: 'Ask the local pet to show a short, low-priority reaction. It cannot control tools or permissions.',
    inputSchema: {
      type: 'object',
      properties: {
        reaction: { type: 'string', enum: ['happy', 'curious', 'thinking', 'surprised', 'encouraging'] },
        petId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$' },
        ttlMs: { type: 'integer', minimum: 1000, maximum: 15000 },
      },
      required: ['reaction'],
      additionalProperties: false,
    },
  },
  {
    name: 'pet_say',
    description: 'Show a short plain-text message above the local pet. It cannot control tools or permissions.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', maxLength: 240 },
        petId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$' },
        ttlMs: { type: 'integer', minimum: 1000, maximum: 15000 },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
]

async function callTool(name, args) {
  if (name === 'pet_status') {
    return textResult(await requestJson('GET', '/v1/presentation/status'))
  }
  if (name !== 'pet_react' && name !== 'pet_say') {
    throw new Error('Unknown presentation tool')
  }
  const input = { ...(args && typeof args === 'object' ? args : {}), kind: name === 'pet_react' ? 'react' : 'say' }
  const result = await requestJson('POST', '/v1/presentation/intents', input)
  return textResult(result, result.accepted === false)
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined
  const method = message.method
  if (typeof method !== 'string') {
    if (id !== undefined) writeMessage({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'initialize') {
    if (id === undefined) return
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agent-pets-presentation', version: '0.8.0' },
      },
    })
    return
  }
  if (method === 'ping') {
    if (id !== undefined) writeMessage({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (method === 'tools/list') {
    if (id !== undefined) writeMessage({ jsonrpc: '2.0', id, result: { tools } })
    return
  }
  if (method === 'tools/call') {
    if (id === undefined) return
    const params = message.params && typeof message.params === 'object' ? message.params : {}
    try {
      const result = await callTool(params.name, params.arguments)
      writeMessage({ jsonrpc: '2.0', id, result })
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: textResult({ error: error instanceof Error ? error.message : 'Presentation request failed' }, true),
      })
    }
    return
  }
  if (id !== undefined) writeMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}

let buffer = ''
let processing = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      try {
        const message = JSON.parse(line)
        processing = processing.then(() => handleMessage(message)).catch(() => {})
      } catch {
        writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
    }
    newline = buffer.indexOf('\n')
  }
})

async function disconnect() {
  if (disconnectSent) return
  disconnectSent = true
  try { await requestJson('POST', '/v1/presentation/disconnect', {}) } catch {}
}

process.stdin.on('end', () => {
  void disconnect().finally(() => { process.exitCode = 0 })
})
process.on('SIGINT', () => { void disconnect().finally(() => process.exit(0)) })
process.on('SIGTERM', () => { void disconnect().finally(() => process.exit(0)) })
