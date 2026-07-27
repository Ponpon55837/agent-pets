export type AgentSource =
  | 'opencode-cli'
  | 'opencode-desktop'
  | 'codex'
  | 'codex-desktop'
  | 'claude'
  | 'claude-desktop'

export type AgentState =
  | 'offline'
  | 'idle'
  | 'thinking'
  | 'tool-running'
  | 'waiting-permission'
  | 'waiting-input'
  | 'success'
  | 'error'

export interface AgentStatusEvent {
  source: AgentSource
  sessionId: string
  project?: string
  state: AgentState
  originalEvent: string
  timestamp: number
  toolName?: string
}

export interface AgentSession {
  key: string
  source: AgentSource
  sessionId: string
  project?: string
  state: AgentState
  lastSeenAt: number
}

export const STATE_PRIORITY: Record<AgentState, number> = {
  'waiting-permission': 100,
  error: 90,
  'waiting-input': 85,
  'tool-running': 80,
  thinking: 70,
  success: 60,
  idle: 20,
  offline: 0,
}

export const STATE_LABELS: Record<AgentState, string> = {
  offline: 'Offline',
  idle: 'Idle',
  thinking: 'Thinking',
  'tool-running': 'Running Tool',
  'waiting-permission': 'Waiting Permission',
  'waiting-input': 'Waiting Input',
  success: 'Success',
  error: 'Error',
}

export const SOURCE_LABELS: Record<AgentSource, string> = {
  'opencode-cli': 'OpenCode CLI',
  'opencode-desktop': 'OpenCode Desktop',
  codex: 'Codex CLI',
  'codex-desktop': 'Codex Desktop',
  claude: 'Claude CLI',
  'claude-desktop': 'Claude Desktop',
}

export const ALL_SOURCES: AgentSource[] = [
  'opencode-cli',
  'opencode-desktop',
  'codex',
  'codex-desktop',
  'claude',
  'claude-desktop',
]
