import type { AgentSource, AgentState, AgentStatusEvent } from '../src/types/agent'
import type { PermissionNotice } from '../src/types/capabilities'

const EXTERNAL_ONLY_PERMISSION_NOTICE: Readonly<PermissionNotice> = Object.freeze({
  responseMode: 'external_only',
})

const MAX_SESSION_ID_LENGTH = 256
const MAX_TEXT_FIELD_LENGTH = 512

const VALID_SOURCES = new Set([
  'opencode-cli', 'opencode-desktop',
  'opencode',
  'codex', 'codex-desktop',
  'claude', 'claude-desktop',
])

const VALID_STATES = new Set([
  'idle', 'thinking', 'tool-running',
  'waiting-permission', 'waiting-input', 'waiting',
  'success', 'error', 'offline',
])

export type EventNormalizationError =
  | 'event must be an object'
  | 'missing required fields'
  | 'invalid source'
  | 'invalid state'
  | 'invalid sessionId'

export type EventNormalizationResult =
  | { ok: true; event: AgentStatusEvent }
  | { ok: false; error: EventNormalizationError }

function normalizeSource(source: string): AgentSource {
  return (source === 'opencode' ? 'opencode-cli' : source) as AgentSource
}

function normalizeState(state: string): AgentState {
  return (state === 'waiting' ? 'waiting-permission' : state) as AgentState
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined
}

export function normalizeAgentStatusEvent(
  value: unknown,
  receivedAt = Date.now(),
): EventNormalizationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'event must be an object' }
  }

  const raw = value as Record<string, unknown>
  if (
    typeof raw.source !== 'string'
    || typeof raw.sessionId !== 'string'
    || typeof raw.state !== 'string'
    || typeof raw.timestamp !== 'number'
    || !Number.isFinite(raw.timestamp)
  ) {
    return { ok: false, error: 'missing required fields' }
  }

  if (!VALID_SOURCES.has(raw.source)) return { ok: false, error: 'invalid source' }
  if (!VALID_STATES.has(raw.state)) return { ok: false, error: 'invalid state' }
  if (raw.sessionId.length === 0 || raw.sessionId.length > MAX_SESSION_ID_LENGTH) {
    return { ok: false, error: 'invalid sessionId' }
  }

  const state = normalizeState(raw.state)
  const project = typeof raw.project === 'string'
    ? (raw.project.split(/[/\\]/).pop() || raw.project).slice(0, MAX_TEXT_FIELD_LENGTH)
    : undefined
  const toolName = optionalText(raw.toolName)
  const originalEvent = optionalText(raw.originalEvent)

  const event: AgentStatusEvent = {
    source: normalizeSource(raw.source),
    sessionId: raw.sessionId,
    state,
    timestamp: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    ...(project ? { project } : {}),
    ...(toolName ? { toolName } : {}),
    ...(originalEvent ? { originalEvent } : {}),
    ...(state === 'waiting-permission'
      ? { permissionNotice: { ...EXTERNAL_ONLY_PERMISSION_NOTICE } }
      : {}),
  }

  return { ok: true, event }
}
