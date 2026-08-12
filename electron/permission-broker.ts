import { randomUUID } from 'node:crypto'
import type { AgentCapabilities } from '../src/types/capabilities'
import type {
  PermissionDecisionSource,
  PermissionDecisionValue,
  PermissionRequestStatus,
  PermissionRequestView,
  PermissionRisk,
} from '../src/types/permission'

const DEFAULT_TTL_MS = 60_000
const MIN_TTL_MS = 15_000
const MAX_TTL_MS = 300_000
const MAX_ACTION_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 280
const MAX_AUDIT_RECORDS = 500
const DEFAULT_MAX_REQUEST_RECORDS = 5_000
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export type PermissionDeliveryResult = 'delivered' | 'already_resolved' | 'rejected'

export interface AdapterPermissionDecision {
  decisionId: string
  requestId: string
  generation: number
  decision: PermissionDecisionValue
  decidedAt: number
  decidedBy: PermissionDecisionSource
  brokerNonce: string
}

export interface PermissionAdapterPort {
  readonly id: string
  readonly capabilities: Pick<AgentCapabilities, 'permissions' | 'permissionModes'>
  respond(
    responseHandle: unknown,
    decision: Readonly<AdapterPermissionDecision>,
    signal: AbortSignal,
  ): Promise<PermissionDeliveryResult>
}

export interface PermissionRequestInput {
  requestId: string
  agentId: string
  sessionId: string
  projectId?: string
  generation: number
  action: string
  description: string
  risk?: PermissionRisk
  ttlMs?: number
  allowedDecisions?: ReadonlyArray<PermissionDecisionValue>
  responseHandle: unknown
}

export type CreatePermissionResult =
  | { ok: true; request: PermissionRequestView }
  | {
    ok: false
    error:
      | 'adapter_unavailable'
      | 'capability_denied'
      | 'invalid_request'
      | 'duplicate_request'
      | 'capacity_exceeded'
  }

export type DecidePermissionResult =
  | { ok: true; status: PermissionRequestStatus }
  | { ok: false; error: 'not_found' | 'invalid_decision' | 'conflict'; status?: PermissionRequestStatus }

export type ExternalResolutionReason =
  | 'agent_resolved'
  | 'adapter_disconnected'
  | 'session_ended'
  | 'system_lock'
  | 'system_suspend'
  | 'broker_shutdown'

export interface PermissionAuditRecord {
  requestId: string
  adapterId: string
  agentId: string
  sessionId: string
  generation: number
  receivedAt: number
  resolvedAt: number
  status: PermissionRequestStatus
  decision?: PermissionDecisionValue
  decidedBy?: PermissionDecisionSource
  terminalReason: string
}

interface RegisteredAdapter {
  id: string
  permissions: AgentCapabilities['permissions']
  permissionModes: ReadonlySet<PermissionDecisionValue>
  respond: PermissionAdapterPort['respond']
}

interface InternalPermissionRequest {
  requestId: string
  adapterId: string
  agentId: string
  sessionId: string
  projectId?: string
  generation: number
  action: string
  description: string
  risk: PermissionRisk
  receivedAt: number
  expiresAt: number
  status: PermissionRequestStatus
  allowedDecisions: ReadonlyArray<PermissionDecisionValue>
  truncated: boolean
  responseHandle: unknown
  adapter: RegisteredAdapter
  order: number
  deliveryAbort?: AbortController
}

export interface PermissionBrokerOptions {
  now?: () => number
  randomId?: () => string
  onChanged?: () => void
  onAudit?: (record: Readonly<PermissionAuditRecord>) => void
  maxRequestRecords?: number
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value)
}

function sanitizeText(value: unknown, maxLength: number): { value: string; truncated: boolean } {
  if (typeof value !== 'string') return { value: '', truncated: false }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    value: normalized.slice(0, maxLength),
    truncated: normalized.length > maxLength,
  }
}

function isDecision(value: unknown): value is PermissionDecisionValue {
  return value === 'allow_once' || value === 'deny'
}

function isDecisionSource(value: unknown): value is PermissionDecisionSource {
  return value === 'bubble' || value === 'hotkey'
}

function isRisk(value: unknown): value is PermissionRisk {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'unknown'
}

function clampTtl(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TTL_MS
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(value)))
}

function isTerminal(status: PermissionRequestStatus): boolean {
  return status !== 'pending' && status !== 'deciding'
}

export class PermissionBroker {
  private readonly adapters = new Map<string, RegisteredAdapter>()
  private readonly requests = new Map<string, InternalPermissionRequest>()
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly audit: PermissionAuditRecord[] = []
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly onChanged?: () => void
  private readonly onAudit?: (record: Readonly<PermissionAuditRecord>) => void
  private readonly maxRequestRecords: number
  private nextOrder = 0

  constructor(options: PermissionBrokerOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
    this.onChanged = options.onChanged
    this.onAudit = options.onAudit
    this.maxRequestRecords = Number.isSafeInteger(options.maxRequestRecords)
      && (options.maxRequestRecords ?? 0) > 0
      ? options.maxRequestRecords!
      : DEFAULT_MAX_REQUEST_RECORDS
  }

  registerAdapter(port: PermissionAdapterPort): void {
    const permissions = port?.capabilities?.permissions
    const rawModes = port?.capabilities?.permissionModes
    if (
      !isIdentifier(port?.id)
      || this.adapters.has(port.id)
      || (permissions !== 'none' && permissions !== 'observe' && permissions !== 'respond')
      || !Array.isArray(rawModes)
      || typeof port?.respond !== 'function'
    ) {
      throw new Error('Invalid or duplicate permission adapter')
    }
    const validModes = rawModes.every(isDecision)
    const permissionModes = new Set(rawModes)
    const modesMatchCapability = permissions === 'respond'
      ? rawModes.length > 0
      : rawModes.length === 0
    if (!validModes || permissionModes.size !== rawModes.length || !modesMatchCapability) {
      throw new Error('Invalid permission adapter capability modes')
    }
    this.adapters.set(port.id, {
      id: port.id,
      permissions,
      permissionModes,
      respond: port.respond.bind(port),
    })
  }

  unregisterAdapter(adapterId: string): void {
    if (!this.adapters.delete(adapterId)) return
    let changed = false
    for (const request of this.requests.values()) {
      if (request.adapterId !== adapterId || isTerminal(request.status)) continue
      this.finish(request, 'cancelled', 'adapter_disconnected')
      changed = true
    }
    if (changed) this.emitChanged()
  }

  createRequest(adapterId: string, input: unknown): CreatePermissionResult {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) return { ok: false, error: 'adapter_unavailable' }
    if (adapter.permissions !== 'respond') return { ok: false, error: 'capability_denied' }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'invalid_request' }
    }
    const candidate = input as Partial<PermissionRequestInput>
    if (
      !isIdentifier(candidate.requestId)
      || !isIdentifier(candidate.agentId)
      || !isIdentifier(candidate.sessionId)
      || (candidate.projectId !== undefined && !isIdentifier(candidate.projectId))
      || !Number.isSafeInteger(candidate.generation)
      || candidate.generation! < 1
      || candidate.responseHandle === undefined
      || candidate.responseHandle === null
      || (candidate.allowedDecisions !== undefined && !Array.isArray(candidate.allowedDecisions))
    ) {
      return { ok: false, error: 'invalid_request' }
    }
    if (this.requests.has(candidate.requestId)) return { ok: false, error: 'duplicate_request' }
    if (this.requests.size >= this.maxRequestRecords) {
      return { ok: false, error: 'capacity_exceeded' }
    }

    const requestedDecisions = candidate.allowedDecisions ?? [...adapter.permissionModes]
    if (
      !requestedDecisions.every(isDecision)
      || new Set(requestedDecisions).size !== requestedDecisions.length
    ) {
      return { ok: false, error: 'invalid_request' }
    }
    const allowedDecisions = Object.freeze(
      requestedDecisions.filter((value) => adapter.permissionModes.has(value)),
    )
    if (allowedDecisions.length === 0) return { ok: false, error: 'capability_denied' }

    const action = sanitizeText(candidate.action, MAX_ACTION_LENGTH)
    const description = sanitizeText(candidate.description, MAX_DESCRIPTION_LENGTH)
    if (!action.value || !description.value) return { ok: false, error: 'invalid_request' }

    const receivedAt = this.readNow()
    if (receivedAt === null) return { ok: false, error: 'invalid_request' }
    const request: InternalPermissionRequest = {
      requestId: candidate.requestId,
      adapterId,
      agentId: candidate.agentId,
      sessionId: candidate.sessionId,
      ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
      generation: candidate.generation!,
      action: action.value,
      description: description.value,
      risk: isRisk(candidate.risk) ? candidate.risk : 'unknown',
      receivedAt,
      expiresAt: receivedAt + clampTtl(candidate.ttlMs),
      status: 'pending',
      allowedDecisions,
      truncated: action.truncated || description.truncated,
      responseHandle: candidate.responseHandle,
      adapter,
      order: this.nextOrder++,
    }
    this.requests.set(request.requestId, request)
    this.scheduleExpiry(request)
    this.emitChanged()
    const active = this.activeRequests()
    const queuePosition = active.findIndex((item) => item.requestId === request.requestId) + 1
    return { ok: true, request: this.toView(request, queuePosition, active.length) }
  }

  listRequests(): PermissionRequestView[] {
    this.expireDue()
    const active = this.activeRequests()
    return active.map((request, index) => this.toView(request, index + 1, active.length))
  }

  async decide(
    requestId: string,
    decision: unknown,
    decidedBy: unknown,
  ): Promise<DecidePermissionResult> {
    if (!isDecision(decision) || !isDecisionSource(decidedBy)) {
      return { ok: false, error: 'invalid_decision' }
    }
    const request = this.requests.get(requestId)
    if (!request) return { ok: false, error: 'not_found' }

    if (request.status !== 'pending') {
      return { ok: false, error: 'conflict', status: request.status }
    }
    const startedAt = this.readNow()
    if (startedAt === null || startedAt >= request.expiresAt) {
      this.finish(request, 'expired', 'ttl')
      this.emitChanged()
      return { ok: false, error: 'conflict', status: 'expired' }
    }
    if (!request.allowedDecisions.includes(decision)) {
      return { ok: false, error: 'invalid_decision', status: request.status }
    }

    request.status = 'deciding'
    request.deliveryAbort = new AbortController()
    this.emitChanged()
    const adapterDecision: Readonly<AdapterPermissionDecision> = Object.freeze({
      decisionId: this.randomId(),
      requestId: request.requestId,
      generation: request.generation,
      decision,
      decidedAt: startedAt,
      decidedBy,
      brokerNonce: this.randomId(),
    })

    let delivery: PermissionDeliveryResult
    try {
      delivery = await request.adapter.respond(
        request.responseHandle,
        adapterDecision,
        request.deliveryAbort.signal,
      )
    } catch {
      if (request.status !== 'deciding') {
        return { ok: false, error: 'conflict', status: request.status }
      }
      this.finish(request, 'delivery_failed', 'adapter_error', decision, decidedBy)
      this.emitChanged()
      return { ok: true, status: 'delivery_failed' }
    }

    if (request.status !== 'deciding') {
      return { ok: false, error: 'conflict', status: request.status }
    }

    if (delivery === 'delivered') {
      const status = decision === 'allow_once' ? 'allowed' : 'denied'
      this.finish(request, status, 'delivered', decision, decidedBy)
      this.emitChanged()
      return { ok: true, status }
    }
    if (delivery === 'already_resolved') {
      this.finish(request, 'cancelled', 'already_resolved', decision, decidedBy)
      this.emitChanged()
      return { ok: true, status: 'cancelled' }
    }
    this.finish(request, 'delivery_failed', 'adapter_rejected', decision, decidedBy)
    this.emitChanged()
    return { ok: true, status: 'delivery_failed' }
  }

  resolveExternally(requestId: string, reason: ExternalResolutionReason): boolean {
    const request = this.requests.get(requestId)
    if (!request || isTerminal(request.status)) return false
    this.finish(request, 'cancelled', reason)
    this.emitChanged()
    return true
  }

  expireDue(now = this.readNow() ?? Number.POSITIVE_INFINITY): number {
    let expired = 0
    for (const request of this.requests.values()) {
      if (isTerminal(request.status) || now < request.expiresAt) continue
      this.finish(request, 'expired', 'ttl')
      expired += 1
    }
    if (expired > 0) this.emitChanged()
    return expired
  }

  shutdown(): void {
    let changed = false
    for (const request of this.requests.values()) {
      if (isTerminal(request.status)) continue
      this.finish(request, 'cancelled', 'broker_shutdown')
      changed = true
    }
    this.adapters.clear()
    for (const timer of this.expiryTimers.values()) clearTimeout(timer)
    this.expiryTimers.clear()
    if (changed) this.emitChanged()
  }

  getAuditRecords(): PermissionAuditRecord[] {
    return this.audit.map((record) => ({ ...record }))
  }

  private toView(
    request: InternalPermissionRequest,
    queuePosition: number,
    queueSize: number,
  ): PermissionRequestView {
    return {
      requestId: request.requestId,
      adapterId: request.adapterId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      generation: request.generation,
      action: request.action,
      description: request.description,
      risk: request.risk,
      receivedAt: request.receivedAt,
      expiresAt: request.expiresAt,
      status: request.status,
      allowedDecisions: [...request.allowedDecisions],
      queuePosition,
      queueSize,
      hotkeyEligible: request.status === 'pending'
        && request.risk !== 'high'
        && !request.truncated,
      truncated: request.truncated,
    }
  }

  private finish(
    request: InternalPermissionRequest,
    status: PermissionRequestStatus,
    terminalReason: string,
    decision?: PermissionDecisionValue,
    decidedBy?: PermissionDecisionSource,
  ): void {
    const expiryTimer = this.expiryTimers.get(request.requestId)
    if (expiryTimer) {
      clearTimeout(expiryTimer)
      this.expiryTimers.delete(request.requestId)
    }
    request.deliveryAbort?.abort()
    request.deliveryAbort = undefined
    request.status = status
    const auditRecord: PermissionAuditRecord = {
      requestId: request.requestId,
      adapterId: request.adapterId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      generation: request.generation,
      receivedAt: request.receivedAt,
      resolvedAt: this.readNow() ?? request.expiresAt,
      status,
      ...(decision ? { decision } : {}),
      ...(decidedBy ? { decidedBy } : {}),
      terminalReason,
    }
    this.audit.push(auditRecord)
    if (this.audit.length > MAX_AUDIT_RECORDS) this.audit.shift()
    try {
      this.onAudit?.(Object.freeze({ ...auditRecord }))
    } catch {
      // Audit persistence failure must not alter an already-terminal decision.
    }
  }

  private emitChanged(): void {
    try {
      this.onChanged?.()
    } catch {
      // Observers cannot interrupt the broker state transition.
    }
  }

  private activeRequests(): InternalPermissionRequest[] {
    return [...this.requests.values()]
      .filter((request) => !isTerminal(request.status))
      .sort((left, right) => left.order - right.order)
  }

  private scheduleExpiry(request: InternalPermissionRequest): void {
    const now = this.readNow() ?? request.receivedAt
    const delay = Math.max(0, request.expiresAt - now)
    const timer = setTimeout(() => {
      this.expiryTimers.delete(request.requestId)
      const current = this.readNow() ?? Number.POSITIVE_INFINITY
      if (current < request.expiresAt && !isTerminal(request.status)) {
        this.scheduleExpiry(request)
        return
      }
      if (isTerminal(request.status)) return
      this.finish(request, 'expired', 'ttl')
      this.emitChanged()
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.expiryTimers.set(request.requestId, timer)
  }

  private readNow(): number | null {
    try {
      const value = this.now()
      return Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
}
