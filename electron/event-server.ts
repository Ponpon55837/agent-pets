import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { BrowserWindow } from 'electron'

export interface AgentStatusEvent {
  source: string
  sessionId: string
  project?: string
  state: string
  originalEvent: string
  timestamp: number
  toolName?: string
}

const MAX_BODY_BYTES = 64 * 1024

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

export function createEventServer(petWindow: BrowserWindow) {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || request.url !== '/v1/events') {
      response.writeHead(404)
      response.end()
      return
    }

    const chunks: Buffer[] = []
    let totalBytes = 0

    request.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        request.destroy()
        response.writeHead(413)
        response.end(JSON.stringify({ error: 'request too large' }))
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (totalBytes > MAX_BODY_BYTES) return

      try {
        const event: AgentStatusEvent = JSON.parse(
          Buffer.concat(chunks).toString('utf8')
        )

        if (!event.source || !event.sessionId || !event.state || !event.timestamp) {
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

        if (typeof event.sessionId !== 'string' || event.sessionId.length > 256) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: 'invalid sessionId' }))
          return
        }

        event.source = normalizeSource(event.source)
        event.state = normalizeState(event.state)

        if (event.project && typeof event.project === 'string') {
          event.project = event.project.split(/[/\\]/).pop() || event.project
        }

        petWindow.webContents.send('agent-status-event', event)

        response.writeHead(204)
        response.end()
      } catch {
        response.writeHead(400)
        response.end(JSON.stringify({ error: 'invalid JSON' }))
      }
    })
  })

  server.listen(17373, '127.0.0.1', () => {
    if (!require('electron').app.isPackaged) {
      console.log('Event server listening on http://127.0.0.1:17373/v1/events')
    }
  })

  return server
}
