import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { timingSafeEqual } from 'node:crypto'

export interface AgentStatusEvent {
  source: string
  sessionId: string
  project?: string
  state: string
  originalEvent?: string
  timestamp: number
  toolName?: string
}

const MAX_BODY_BYTES = 64 * 1024
const MAX_EVENTS_PER_WINDOW = 500
const RATE_WINDOW_MS = 10_000
const MAX_TEXT_FIELD_LENGTH = 512

const VALID_SOURCES = [
  'opencode-cli', 'opencode-desktop',
  'opencode',
  'codex', 'codex-desktop',
  'claude', 'claude-desktop',
]

const VALID_STATES = [
  'idle', 'thinking', 'tool-running',
  'waiting-permission', 'waiting-input', 'waiting',
  'success', 'error', 'offline',
]

function normalizeSource(source: string): string {
  if (source === 'opencode') return 'opencode-cli'
  return source
}

function normalizeState(state: string): string {
  if (state === 'waiting') return 'waiting-permission'
  return state
}

export function createEventServer(
  getWindows: () => BrowserWindow[],
  eventToken: string,
  onEvent?: (event: AgentStatusEvent) => void,
) {
  let rateWindowStartedAt = Date.now()
  let eventsInWindow = 0

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || request.url !== '/v1/events') {
      response.writeHead(404)
      response.end()
      return
    }

    // CLI hooks do not send Origin. Reject browser-originated requests so an
    // arbitrary website cannot spoof agent state through the loopback server.
    if (request.headers.origin) {
      response.writeHead(403)
      response.end(JSON.stringify({ error: 'browser origins are not allowed' }))
      return
    }

    const suppliedToken = request.headers['x-agent-pets-token']
    const supplied = typeof suppliedToken === 'string' ? Buffer.from(suppliedToken) : Buffer.alloc(0)
    const expected = Buffer.from(eventToken)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401)
      response.end(JSON.stringify({ error: 'unauthorized' }))
      request.resume()
      return
    }

    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      response.writeHead(415)
      response.end(JSON.stringify({ error: 'application/json required' }))
      return
    }

    const now = Date.now()
    if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
      rateWindowStartedAt = now
      eventsInWindow = 0
    }
    eventsInWindow += 1
    if (eventsInWindow > MAX_EVENTS_PER_WINDOW) {
      response.writeHead(429, { 'retry-after': '10' })
      response.end(JSON.stringify({ error: 'too many events' }))
      request.resume()
      return
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    let bodyRejected = false

    request.on('data', (chunk: Buffer) => {
      if (bodyRejected) return
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        bodyRejected = true
        response.writeHead(413)
        response.end(JSON.stringify({ error: 'request too large' }))
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (bodyRejected) return

      try {
        const parsed: unknown = JSON.parse(
          Buffer.concat(chunks).toString('utf8')
        )
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: 'event must be an object' }))
          return
        }
        const event = parsed as AgentStatusEvent

        if (
          typeof event.source !== 'string'
          || typeof event.sessionId !== 'string'
          || typeof event.state !== 'string'
          || typeof event.timestamp !== 'number'
          || !Number.isFinite(event.timestamp)
        ) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: 'missing required fields' }))
          return
        }

        if (!VALID_SOURCES.includes(event.source)) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: 'invalid source' }))
          return
        }

        if (!VALID_STATES.includes(event.state)) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: 'invalid state' }))
          return
        }

        if (event.sessionId.length === 0 || event.sessionId.length > 256) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: 'invalid sessionId' }))
          return
        }

        event.source = normalizeSource(event.source)
        event.state = normalizeState(event.state)
        // Status ordering and mood calculations use receipt time, not an
        // attacker-controlled or badly skewed client clock.
        event.timestamp = Date.now()

        event.project = typeof event.project === 'string'
          ? (event.project.split(/[/\\]/).pop() || event.project).slice(0, MAX_TEXT_FIELD_LENGTH)
          : undefined
        event.toolName = typeof event.toolName === 'string'
          ? event.toolName.slice(0, MAX_TEXT_FIELD_LENGTH)
          : undefined
        event.originalEvent = typeof event.originalEvent === 'string'
          ? event.originalEvent.slice(0, MAX_TEXT_FIELD_LENGTH)
          : undefined

        for (const win of getWindows()) {
          win.webContents.send('agent-status-event', event)
        }
        onEvent?.(event)

        response.writeHead(204)
        response.end()
      } catch {
        response.writeHead(400)
        response.end(JSON.stringify({ error: 'invalid JSON' }))
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    // An unhandled 'error' on a net.Server throws and kills the whole process
    // by default — e.g. a second app instance launched while one is already
    // running would otherwise crash instead of just failing to bind.
    if (err.code === 'EADDRINUSE') {
      console.error('Port 17373 already in use — another Agent Pets instance may be running.')
    } else {
      console.error('Event server error:', err)
    }
  })

  server.listen(17373, '127.0.0.1', () => {
    if (!app.isPackaged) {
      console.log('Event server listening on http://127.0.0.1:17373/v1/events')
    }
  })

  return server
}
