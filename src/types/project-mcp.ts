export const PROJECT_MCP_CLIENTS = ['codex', 'claude', 'opencode'] as const

export type ProjectMcpClientId = typeof PROJECT_MCP_CLIENTS[number]

export type ProjectMcpInstallStatus =
  | 'installed'
  | 'already_configured'
  | 'not_configured'
  | 'conflict'
  | 'error'

export interface ProjectMcpInstallResult {
  client: ProjectMcpClientId
  status: ProjectMcpInstallStatus
  configPath: string
  message?: string
}

export interface ProjectMcpSetupSummary {
  ok: boolean
  cancelled?: boolean
  projectPath?: string
  results: ProjectMcpInstallResult[]
  error?: string
}

export type ProjectMcpProjectStatus =
  | 'connected'
  | 'partial'
  | 'conflict'
  | 'missing'
  | 'error'

export interface ProjectMcpProjectRecord {
  projectPath: string
  projectName: string
  registeredAt: string
  lastCheckedAt: string
  status: ProjectMcpProjectStatus
  results: ProjectMcpInstallResult[]
}

export interface ProjectMcpRegistrySnapshot {
  ok: boolean
  projects: ProjectMcpProjectRecord[]
  error?: string
}

export type ProjectMcpRemovalStatus =
  | 'removed'
  | 'already_absent'
  | 'conflict'
  | 'error'

export interface ProjectMcpRemovalResult {
  client: ProjectMcpClientId
  status: ProjectMcpRemovalStatus
  configPath: string
  message?: string
}

export interface ProjectMcpRemovalSummary {
  ok: boolean
  projectPath: string
  results: ProjectMcpRemovalResult[]
  error?: string
}
