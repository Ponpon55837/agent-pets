import type { PermissionNotice } from './capabilities'
import type { AgentAdapterId } from './agent-adapter'

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
  adapterId?: AgentAdapterId
  source: AgentSource
  sessionId: string
  project?: string
  state: AgentState
  originalEvent?: string
  timestamp: number
  toolName?: string
  permissionNotice?: PermissionNotice
}

export interface AgentSession {
  key: string
  source: AgentSource
  sessionId: string
  project?: string
  state: AgentState
  lastSeenAt: number
  toolName?: string
  permissionNotice?: PermissionNotice
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

// Compact form for the pet's floating status line, where every character
// counts — the full STATE_LABELS stay for the roomy session-list panel.
export const STATE_LABELS_SHORT: Record<AgentState, string> = {
  offline: 'Offline',
  idle: 'Idle',
  thinking: 'Thinking',
  'tool-running': 'Running',
  'waiting-permission': 'Permission',
  'waiting-input': 'Waiting',
  success: 'Success',
  error: 'Error',
}

export const STATE_COLORS: Record<AgentState, string> = {
  offline: '#555',
  idle: '#666',
  thinking: '#8b9cf7',
  'tool-running': '#8b9cf7',
  'waiting-permission': '#c8b450',
  'waiting-input': '#c8b450',
  success: '#50c878',
  error: '#ff6b6b',
}

export const SOURCE_LABELS: Record<AgentSource, string> = {
  'opencode-cli': 'OpenCode CLI',
  'opencode-desktop': 'OpenCode Desktop',
  codex: 'Codex CLI',
  'codex-desktop': 'Codex Desktop',
  claude: 'Claude CLI',
  'claude-desktop': 'Claude Desktop',
}

// Groups CLI + Desktop variants of the same tool onto a single status line.
export const SOURCE_FAMILIES: { key: string; label: string; sources: AgentSource[] }[] = [
  { key: 'codex', label: 'Codex', sources: ['codex', 'codex-desktop'] },
  { key: 'claude', label: 'Claude', sources: ['claude', 'claude-desktop'] },
  { key: 'opencode', label: 'OpenCode', sources: ['opencode-cli', 'opencode-desktop'] },
]

export const ALL_SOURCES: AgentSource[] = [
  'opencode-cli',
  'opencode-desktop',
  'codex',
  'codex-desktop',
  'claude',
  'claude-desktop',
]
