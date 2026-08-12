import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { timingSafeEqual } from 'node:crypto'
import type { AgentStatusEvent } from '../src/types/agent'
import { normalizeAgentStatusEvent } from './event-normalizer'
export type { AgentStatusEvent } from '../src/types/agent'

const MAX_BODY_BYTES = 64 * 1024
const MAX_EVENTS_PER_WINDOW = 500
const RATE_WINDOW_MS = 10_000

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
        const normalized = normalizeAgentStatusEvent(parsed)
        if (!normalized.ok) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: normalized.error }))
          return
        }
        const { event } = normalized

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
