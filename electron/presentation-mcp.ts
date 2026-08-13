import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { PresentationController } from './presentation-controller.ts'

export const PRESENTATION_MCP_PORT = 17_375
export const PRESENTATION_TOKEN_HEADER = 'x-agent-pets-presentation-token'
export const PRESENTATION_CLIENT_HEADER = 'x-agent-pets-client'
const MAX_BODY_BYTES = 16 * 1024
const MAX_REQUESTS_PER_WINDOW = 60
const RATE_WINDOW_MS = 10_000

interface PresentationMcpServerOptions {
  token: string
  controller: PresentationController
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readClientId(request: IncomingMessage): string | null {
  const value = request.headers[PRESENTATION_CLIENT_HEADER]
  return typeof value === 'string' ? value : null
}

function readToken(request: IncomingMessage): Buffer {
  const value = request.headers[PRESENTATION_TOKEN_HEADER]
  return Buffer.from(typeof value === 'string' ? value : '')
}

function isAuthorized(request: IncomingMessage, expectedToken: Buffer): boolean {
  const supplied = readToken(request)
  return supplied.length === expectedToken.length && timingSafeEqual(supplied, expectedToken)
}

function isAllowedPath(request: IncomingMessage): boolean {
  return request.url === '/v1/presentation/status'
    || request.url === '/v1/presentation/intents'
    || request.url === '/v1/presentation/disconnect'
}

export function createPresentationMcpServer(options: PresentationMcpServerOptions): Server {
  const expectedToken = Buffer.from(options.token)
  let rateWindowStartedAt = Date.now()
  let requestsInWindow = 0

  const server = createServer((request, response) => {
    if (!isAllowedPath(request)) {
      writeJson(response, 404, { error: 'not_found' })
      return
    }
    if (request.headers.origin) {
      writeJson(response, 403, { error: 'browser origins are not allowed' })
      return
    }
    if (!isAuthorized(request, expectedToken)) {
      writeJson(response, 401, { error: 'unauthorized' })
      request.resume()
      return
    }

    const now = Date.now()
    if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
      rateWindowStartedAt = now
      requestsInWindow = 0
    }
    requestsInWindow += 1
    if (requestsInWindow > MAX_REQUESTS_PER_WINDOW) {
      response.setHeader('retry-after', '10')
      writeJson(response, 429, { error: 'too_many_requests' })
      request.resume()
      return
    }

    if (request.method === 'GET' && request.url === '/v1/presentation/status') {
      writeJson(response, 200, {
        ...options.controller.getStatus(),
        queueDepth: options.controller.getQueueDepth(),
      })
      return
    }

    if (request.url === '/v1/presentation/status') {
      response.setHeader('allow', 'GET')
      writeJson(response, 405, { error: 'method_not_allowed' })
      request.resume()
      return
    }

    if (request.method !== 'POST') {
      response.setHeader('allow', request.url === '/v1/presentation/status' ? 'GET' : 'POST')
      writeJson(response, 405, { error: 'method_not_allowed' })
      return
    }
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      writeJson(response, 415, { error: 'application/json required' })
      request.resume()
      return
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    let rejected = false
    request.on('data', (chunk: Buffer) => {
      if (rejected) return
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        rejected = true
        writeJson(response, 413, { error: 'request_too_large' })
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (rejected) return
      let body: unknown = {}
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        body = raw.length > 0 ? JSON.parse(raw) : {}
      } catch {
        writeJson(response, 400, { error: 'invalid_json' })
        return
      }

      const clientId = readClientId(request)
      if (request.url === '/v1/presentation/disconnect') {
        writeJson(response, 200, {
          removed: clientId ? options.controller.disconnectClient(clientId) : 0,
        })
        return
      }
      if (request.url !== '/v1/presentation/intents' || !clientId) {
        writeJson(response, 400, { error: 'client_id_required' })
        return
      }
      writeJson(response, 200, options.controller.submit(clientId, body))
    })
  })

  return server
}
