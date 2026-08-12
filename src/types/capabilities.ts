export type CapabilitySupport = 'none' | 'observe' | 'respond'

export type PermissionDecisionMode = 'allow_once' | 'deny'

export interface AgentCapabilities {
  lifecycle: boolean
  sessions: boolean
  projects: boolean
  toolActivity: boolean
  tokenUsage: 'none' | 'estimated' | 'exact'
  quota: 'none' | 'local' | 'provider'
  waitingInput: boolean
  permissions: CapabilitySupport
  permissionModes: ReadonlyArray<PermissionDecisionMode>
  orderedEvents: boolean
  healthCheck: boolean
}

export interface PermissionNotice {
  responseMode: 'external_only'
}

export const GENERIC_HTTP_CAPABILITIES: Readonly<AgentCapabilities> = Object.freeze({
  lifecycle: true,
  sessions: true,
  projects: true,
  toolActivity: true,
  tokenUsage: 'none',
  quota: 'none',
  waitingInput: true,
  permissions: 'none',
  permissionModes: Object.freeze([]),
  orderedEvents: false,
  healthCheck: false,
})

export const EXTERNAL_ONLY_PERMISSION_NOTICE: Readonly<PermissionNotice> = Object.freeze({
  responseMode: 'external_only',
})
