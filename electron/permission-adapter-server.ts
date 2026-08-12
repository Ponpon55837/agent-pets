import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import * as path from 'node:path'
import type { PermissionDecisionValue } from '../src/types/permission'
import {
  PermissionBroker,
  type AdapterPermissionDecision,
  type PermissionAdapterPort,
  type PermissionDeliveryResult,
} from './permission-broker.ts'

export const PERMISSION_ADAPTER_PORT = 17_374

const MAX_BODY_BYTES = 16 * 1024
const MAX_CREATE_REQUESTS_PER_MINUTE = 60
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SOURCES = new Set(['opencode-cli', 'opencode-desktop'])

interface RelayHandle {
  relayKey: string
}

interface PendingDelivery {
  decision: Readonly<AdapterPermissionDecision>
  resolve: (result: PermissionDeliveryResult) => void
  reject: (error: Error) => void
  detachAbort: () => void
}

interface ExternalRequestRecord {
  brokerRequestId: string
  relayKey: string
}

interface CreatePayload {
  source: 'opencode-cli' | 'opencode-desktop'
  instanceId: string
  permissionId: string
  sessionId: string
  project?: string
  permission: string
  title?: string
  patterns?: string[]
}

export class PermissionAdapterRelay {
  private readonly pending = new Map<string, PendingDelivery>()

  createPort(id: 'opencode-cli' | 'opencode-desktop'): PermissionAdapterPort {
    return {
      id,
      capabilities: {
        permissions: 'respond',
        permissionModes: ['allow_once', 'deny'],
      },
      respond: (handle, decision, signal) => this.respond(handle, decision, signal),
    }
  }

  poll(relayKey: string): Pick<AdapterPermissionDecision, 'decisionId' | 'decision'> | null {
    const delivery = this.pending.get(relayKey)
    if (!delivery) return null
    return {
      decisionId: delivery.decision.decisionId,
      decision: delivery.decision.decision,
    }
  }

  complete(
    relayKey: string,
    decisionId: string,
    result: PermissionDeliveryResult,
  ): boolean {
    const delivery = this.pending.get(relayKey)
    if (!delivery || delivery.decision.decisionId !== decisionId) return false
    this.pending.delete(relayKey)
    delivery.detachAbort()
    delivery.resolve(result)
    return true
  }

  shutdown(): void {
    for (const delivery of this.pending.values()) {
      delivery.detachAbort()
      delivery.reject(new Error('Permission adapter relay stopped'))
    }
    this.pending.clear()
  }

  private respond(
    handle: unknown,
    decision: Readonly<AdapterPermissionDecision>,
    signal: AbortSignal,
  ): Promise<PermissionDeliveryResult> {
    if (!isRelayHandle(handle) || this.pending.has(handle.relayKey) || signal.aborted) {
      return Promise.resolve('rejected')
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const delivery = this.pending.get(handle.relayKey)
        if (!delivery || delivery.decision.decisionId !== decision.decisionId) return
        this.pending.delete(handle.relayKey)
        delivery.detachAbort()
        reject(new Error('Permission delivery aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(handle.relayKey, {
        decision,
        resolve,
        reject,
        detachAbort: () => signal.removeEventListener('abort', onAbort),
      })
    })
  }
}

export interface PermissionAdapterServerOptions {
  token: string
  broker: PermissionBroker
  relay: PermissionAdapterRelay
  now?: () => number
  randomId?: () => string
}

export function createPermissionAdapterServer(options: PermissionAdapterServerOptions): Server {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const records = new Map<string, ExternalRequestRecord>()
  const createWindows = new Map<string, { startedAt: number; count: number }>()

  return createServer(async (request, response) => {
    setSecurityHeaders(response)
    if (request.headers.origin) {
      sendJson(response, 403, { error: 'browser_origins_forbidden' })
      return
    }
    if (!isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, { error: 'forbidden' })
      return
    }
    if (!hasValidToken(request, options.token)) {
      sendJson(response, 401, { error: 'unauthorized' })
      return
    }
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      sendJson(response, 415, { error: 'application_json_required' })
      return
    }

    const route = `${request.method ?? ''} ${request.url?.split('?')[0] ?? ''}`
    if (route === 'POST /v1/permission/request') {
      if (!consumeCreateBudget(createWindows, request.socket.remoteAddress ?? 'loopback', now())) {
        sendJson(response, 429, { error: 'rate_limited' })
        return
      }
      const body = await readJsonBody(request)
      const payload = normalizeCreatePayload(body)
      if (!payload) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }

      const externalKey = toExternalKey(payload.source, payload.instanceId, payload.permissionId)
      const existing = records.get(externalKey)
      if (existing) {
        sendJson(response, 200, { requestId: existing.brokerRequestId })
        return
      }

      const relayKey = randomId()
      const brokerRequestId = randomId()
      const projectId = sanitizeProjectId(payload.project)
      const created = options.broker.createRequest(payload.source, {
        requestId: brokerRequestId,
        agentId: payload.source,
        sessionId: payload.sessionId,
        ...(projectId ? { projectId } : {}),
        generation: 1,
        action: payload.permission,
        description: describePermission(payload),
        risk: classifyRisk(payload.permission),
        allowedDecisions: ['allow_once', 'deny'],
        responseHandle: { relayKey } satisfies RelayHandle,
      })
      if (!created.ok) {
        const status = created.error === 'capacity_exceeded' ? 503 : 400
        sendJson(response, status, { error: created.error })
        return
      }
      records.set(externalKey, { brokerRequestId, relayKey })
      sendJson(response, 201, { requestId: brokerRequestId })
      return
    }

    if (route === 'POST /v1/permission/decision') {
      const lookup = normalizeLookupPayload(await readJsonBody(request))
      if (!lookup) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const record = records.get(toExternalKey(lookup.source, lookup.instanceId, lookup.permissionId))
      if (!record) {
        sendJson(response, 404, { error: 'not_found' })
        return
      }
      const decision = options.relay.poll(record.relayKey)
      if (!decision) {
        const stillActive = options.broker.listRequests()
          .some((request) => request.requestId === record.brokerRequestId)
        if (!stillActive) {
          sendJson(response, 410, { error: 'resolved' })
          return
        }
        response.statusCode = 204
        response.end()
        return
      }
      sendJson(response, 200, decision)
      return
    }

    if (route === 'POST /v1/permission/result') {
      const result = normalizeResultPayload(await readJsonBody(request))
      if (!result) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const record = records.get(toExternalKey(result.source, result.instanceId, result.permissionId))
      if (!record || !options.relay.complete(record.relayKey, result.decisionId, result.result)) {
        sendJson(response, 409, { error: 'conflict' })
        return
      }
      response.statusCode = 204
      response.end()
      return
    }

    if (route === 'POST /v1/permission/resolved') {
      const lookup = normalizeLookupPayload(await readJsonBody(request))
      if (!lookup) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const record = records.get(toExternalKey(lookup.source, lookup.instanceId, lookup.permissionId))
      if (!record) {
        response.statusCode = 204
        response.end()
        return
      }
      options.broker.resolveExternally(record.brokerRequestId, 'agent_resolved')
      response.statusCode = 204
      response.end()
      return
    }

    sendJson(response, 404, { error: 'not_found' })
  })
}

function isRelayHandle(value: unknown): value is RelayHandle {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && isIdentifier((value as Record<string, unknown>).relayKey),
  )
}

function normalizeCreatePayload(value: unknown): CreatePayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (
    typeof data.source !== 'string'
    || !SOURCES.has(data.source)
    || !isIdentifier(data.instanceId)
    || !isIdentifier(data.permissionId)
    || !isIdentifier(data.sessionId)
  ) return null

  const permission = sanitizeText(data.permission, 80)
  if (!permission) return null
  const title = sanitizeText(data.title, 160)
  const patterns = Array.isArray(data.patterns)
    ? data.patterns.slice(0, 5).map((item) => sanitizeText(item, 120)).filter(Boolean)
    : []
  if (data.patterns !== undefined && !Array.isArray(data.patterns)) return null

  return {
    source: data.source as CreatePayload['source'],
    instanceId: data.instanceId,
    permissionId: data.permissionId,
    sessionId: data.sessionId,
    ...(typeof data.project === 'string' ? { project: data.project.slice(0, 512) } : {}),
    permission,
    ...(title ? { title } : {}),
    ...(patterns.length > 0 ? { patterns } : {}),
  }
}

function normalizeLookupPayload(value: unknown): Pick<CreatePayload, 'source' | 'instanceId' | 'permissionId'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (
    typeof data.source !== 'string'
    || !SOURCES.has(data.source)
    || !isIdentifier(data.instanceId)
    || !isIdentifier(data.permissionId)
  ) return null
  return {
    source: data.source as CreatePayload['source'],
    instanceId: data.instanceId,
    permissionId: data.permissionId,
  }
}

function normalizeResultPayload(value: unknown): (
  Pick<CreatePayload, 'source' | 'instanceId' | 'permissionId'>
  & { decisionId: string; result: PermissionDeliveryResult }
) | null {
  const lookup = normalizeLookupPayload(value)
  if (!lookup || !value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (!isIdentifier(data.decisionId) || !isDeliveryResult(data.result)) return null
  return { ...lookup, decisionId: data.decisionId, result: data.result }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function isDeliveryResult(value: unknown): value is PermissionDeliveryResult {
  return value === 'delivered' || value === 'already_resolved' || value === 'rejected'
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function sanitizeProjectId(project: string | undefined): string | undefined {
  if (!project) return undefined
  const base = path.basename(project).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128)
  return isIdentifier(base) ? base : undefined
}

function describePermission(payload: CreatePayload): string {
  if (payload.title) return payload.title
  if (payload.patterns?.length) return payload.patterns.join(', ')
  return `OpenCode requests ${payload.permission} permission.`
}

function classifyRisk(permission: string): 'low' | 'medium' | 'high' | 'unknown' {
  const normalized = permission.toLowerCase()
  if (normalized.includes('bash') || normalized.includes('edit') || normalized.includes('write')) return 'high'
  if (normalized.includes('external') || normalized.includes('task')) return 'high'
  if (normalized.includes('read') || normalized.includes('web')) return 'medium'
  return 'unknown'
}

function toExternalKey(source: string, instanceId: string, permissionId: string): string {
  return `${source}:${instanceId}:${permissionId}`
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function hasValidToken(request: IncomingMessage, expected: string): boolean {
  const value = request.headers['x-agent-pets-permission-token']
  if (typeof value !== 'string') return false
  const actualBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) return null
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) return null
      chunks.push(buffer)
    }
    if (size === 0) return null
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('x-content-type-options', 'nosniff')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.end(JSON.stringify(body))
}

function consumeCreateBudget(
  windows: Map<string, { startedAt: number; count: number }>,
  key: string,
  now: number,
): boolean {
  const current = windows.get(key)
  if (!current || now - current.startedAt >= 60_000 || now < current.startedAt) {
    windows.set(key, { startedAt: now, count: 1 })
    return true
  }
  if (current.count >= MAX_CREATE_REQUESTS_PER_MINUTE) return false
  current.count += 1
  return true
}

export function mapOpenCodeDecision(decision: PermissionDecisionValue): 'once' | 'reject' {
  return decision === 'allow_once' ? 'once' : 'reject'
}
