import type { PermissionNotice } from './capabilities'
import type { AgentAdapterId } from './agent-adapter'
import type { AgentHost } from './host-app'

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

export interface AgentTokenUsage {
  input?: number
  output?: number
  quality: 'estimated' | 'exact'
}

export interface AgentStatusEvent {
  adapterId?: AgentAdapterId
  source: AgentSource
  sessionId: string
  project?: string
  /** Main-process canonical project fingerprint; never a raw path. */
  projectId?: string
  /** Main-process routing result; absent means preserve legacy selected-pet behavior. */
  routedPetId?: string
  state: AgentState
  originalEvent?: string
  timestamp: number
  eventId?: string
  sourceEventId?: string
  toolName?: string
  tokenUsage?: AgentTokenUsage
  permissionNotice?: PermissionNotice
  /** Terminal / IDE / desktop app the session runs in (allowlisted id only). */
  host?: AgentHost
}

export interface AgentSession {
  key: string
  source: AgentSource
  sessionId: string
  project?: string
  projectId?: string
  routedPetId?: string
  state: AgentState
  lastSeenAt: number
  /** When this session was first seen; a stable tie-break for "who needs you" ordering. */
  firstSeenAt?: number
  toolName?: string
  permissionNotice?: PermissionNotice
  host?: AgentHost
}

// --- 狀態 registry（主程序與 renderer 共用的策略） --------------------------------
// 每個 AgentState 的策略只寫在這一張表；satisfies 讓新增狀態時漏填任何一格都編譯失敗。
// 畫面呈現（標籤、顏色、aria、迷你徽章、音效）在 src/utils/agent-state-presentation.ts，
// 這裡只放主程序也要用的純資料，不能匯入 Vue 或 i18n runtime。

/** sessions.final_state 的目標值；keep 代表沿用上一輪的結果（idle 不改變結局）。 */
export type AgentStateHistoryOutcome = 'success' | 'error' | 'cancelled' | 'open' | 'keep'

export interface AgentStatePolicy {
  /** 多個 session 同時存在時，誰代表寵物的整體狀態；數字越大越優先。 */
  readonly priority: number
  /**
   * 桌面通知；null 表示不通知。terminal 是結束類通知：會彙整成一則，點了也不切換 App；
   * 非 terminal 是在等使用者，通知會帶上 session 讓點擊能跳回去。
   */
  readonly notification: { readonly terminal: boolean } | null
  readonly historyOutcome: AgentStateHistoryOutcome
}

export const AGENT_STATE_POLICY = {
  offline: { priority: 0, notification: null, historyOutcome: 'cancelled' },
  idle: { priority: 20, notification: null, historyOutcome: 'keep' },
  thinking: { priority: 70, notification: null, historyOutcome: 'open' },
  'tool-running': { priority: 80, notification: null, historyOutcome: 'open' },
  'waiting-permission': { priority: 100, notification: { terminal: false }, historyOutcome: 'open' },
  'waiting-input': { priority: 85, notification: { terminal: false }, historyOutcome: 'open' },
  success: { priority: 60, notification: { terminal: true }, historyOutcome: 'success' },
  error: { priority: 90, notification: { terminal: true }, historyOutcome: 'error' },
} as const satisfies Record<AgentState, AgentStatePolicy>

export const AGENT_STATES = Object.keys(AGENT_STATE_POLICY) as readonly AgentState[]

/** 執行期檢查；用 hasOwn 而不是 in，'constructor' 之類原型鏈上的名稱不會被當成狀態。 */
export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && Object.hasOwn(AGENT_STATE_POLICY, value)
}

/** 會發桌面通知的狀態，由上表推導，主程序的通知標題表用它強制窮盡。 */
export type NotifiableAgentState = {
  [K in AgentState]: (typeof AGENT_STATE_POLICY)[K]['notification'] extends null ? never : K
}[AgentState]

export const STATE_PRIORITY: Readonly<Record<AgentState, number>> = Object.fromEntries(
  AGENT_STATES.map(state => [state, AGENT_STATE_POLICY[state].priority]),
) as Record<AgentState, number>

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
