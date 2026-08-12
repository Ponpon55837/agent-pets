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
