export type PermissionDecisionValue = 'allow_once' | 'deny'

export type PermissionDecisionSource = 'bubble' | 'hotkey'

export type PermissionRisk = 'low' | 'medium' | 'high' | 'unknown'

export type PermissionRequestStatus =
  | 'pending'
  | 'deciding'
  | 'allowed'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'delivery_failed'

export interface PermissionRequestView {
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
  queuePosition: number
  queueSize: number
  hotkeyEligible: boolean
  truncated: boolean
}

/**
 * Renderer-side result of a request that has left the broker's active queue.
 * It carries no request content beyond the already-sanitized action label, so
 * it is safe to keep around for a few seconds after the request is gone.
 */
export type PermissionOutcomeKind =
  | 'expired'
  | 'cancelled'
  | 'delivery_failed'
  | 'conflict'
  | 'error'

export interface PermissionOutcome {
  kind: PermissionOutcomeKind
  requestId: string
  agentId: string
  action: string
  projectId?: string
  at: number
}

/** What `decidePermission` reports back to its caller. */
export type PermissionDecideResult =
  | { ok: true; status: 'allowed' | 'denied' }
  | { ok: false; kind: PermissionOutcomeKind }
