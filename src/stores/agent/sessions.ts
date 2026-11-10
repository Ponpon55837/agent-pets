// Agent 工作階段的生命週期：事件進來建立／更新、淘汰過期、重載後還原、成功狀態自動回 idle，並依事件觸發心情、泡泡、提醒與音效。
//
// - 事件輸入：`handleEvent(event)`（每個 agent 狀態事件，回傳該播的音效 cue 或 null）、
//   `cleanupStale()`／`handleSuccessTimeout()`（App.vue 的定期計時器）、`restoreSessionSnapshot()`（renderer 重載後）、
//   `removeSession()`／`clearOfflineSessions()`（使用者操作）、`settleWaitingPermission()`（權限請求消失）。
// - 計時器：無；週期性呼叫由 App.vue 驅動。等待輸入的提醒計時器在 unread-alerts.ts。
// - storage：無。
// - 跨視窗同步：不同步；兩個視窗各自吃同一串事件，只有 App.vue 指定的視窗會真的出聲。
import type { AgentSession, AgentSource, AgentStatusEvent } from '@/types/agent'
import { isAgentState, isQuotaCapableSource } from '@/types/agent'
import { isHostAppId, type AgentHost } from '@/types/host-app'
import type { SessionJumpAction, SessionJumpResult } from '@/types/session-jump'
import type { SoundCue } from '@/types/sound'
import { AgentSessionIndex } from '@/utils/agent-session-index'
import { AGENT_STATE_PRESENTATION } from '@/utils/agent-state-presentation'
import { SUCCESS_DISPLAY_MS } from '@/utils/pet-motion-plan'
import { SESSION_REMOVE_MS, sessionLifecycleAction } from '@/utils/session-lifecycle'
import { shouldPlaySuccessSound } from '@/utils/sound-policy'
import type { usePetMood } from '@/stores/agent/mood'
import { isUrgentForPresentation } from '@/stores/agent/presentation'
import type { useToastQueue } from '@/stores/agent/toast'
import type { useUnreadAlerts } from '@/stores/agent/unread-alerts'

const MAX_SESSION_COUNT = 200

function sanitizeHost(value: unknown): AgentHost | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!isHostAppId(raw.app)) return undefined
  if (raw.kind !== 'terminal' && raw.kind !== 'ide' && raw.kind !== 'desktop' && raw.kind !== 'unknown') return undefined
  return { kind: raw.kind, app: raw.app, switchable: raw.switchable === true }
}

export interface SessionsDeps {
  sessionsByKey: Map<string, AgentSession>
  petMood: ReturnType<typeof usePetMood>
  showToast: ReturnType<typeof useToastQueue>['showToast']
  unreadAlerts: Pick<ReturnType<typeof useUnreadAlerts>, 'noteUnreadResult' | 'scheduleWaitingInputReminder' | 'cancelWaitingInputReminder'>
  clearPresentation: () => void
  /** 有 session 在 success／error 且屬於有額度的家族時通知 quota 模組。 */
  markQuotaStale: () => void
  forgetDismissedNotice: (key: string) => void
  /** 權限模組在 session 之後才建立，所以用函式延後解析。 */
  hasPendingPermission: () => boolean
}

export function useSessions(deps: SessionsDeps) {
  const { sessionsByKey, petMood, showToast, unreadAlerts } = deps
  const sessionIndex = new AgentSessionIndex(sessionsByKey)

  function getSessionKey(source: AgentSource, sessionId: string): string {
    return `${source}:${sessionId}`
  }

  // 回傳這個事件值得播的音效（或 null），由呼叫端 App.vue 決定要不要播、在哪裡播：
  // 寵物與面板兩個視窗都跑同一份 store，音效只能由其中一個發出，否則會播兩次。
  function handleEvent(event: AgentStatusEvent): SoundCue | null {
    const key = getSessionKey(event.source, event.sessionId)
    const existing = sessionIndex.get(key)
    const prevState = existing?.state
    const host = sanitizeHost(event.host)

    if (event.originalEvent === 'AgentPetsIntegrationTest' && event.state === 'offline') {
      removeSession(key)
      return null
    }

    if (existing) {
      existing.state = event.state
      existing.lastSeenAt = event.timestamp
      existing.project = event.project
      existing.projectId = event.projectId
      existing.routedPetId = event.routedPetId
      existing.toolName = event.toolName
      existing.permissionNotice = event.permissionNotice
      if (host) existing.host = host
      sessionIndex.updatePriority(key, event.state, event.timestamp)
    } else {
      const evicted = sessionIndex.upsert({
        key,
        source: event.source,
        sessionId: event.sessionId,
        project: event.project,
        projectId: event.projectId,
        routedPetId: event.routedPetId,
        state: event.state,
        lastSeenAt: event.timestamp,
        firstSeenAt: event.timestamp,
        toolName: event.toolName,
        permissionNotice: event.permissionNotice,
        ...(host ? { host } : {}),
      }, MAX_SESSION_COUNT)
      if (evicted) petMood.forgetTask(evicted.key)
    }

    if (isUrgentForPresentation(event.state)) deps.clearPresentation()

    // Read before awardTaskProgress clears it on a terminal state.
    const taskStartedAt = petMood.taskStartedAt(key)
    const taskElapsedMs = taskStartedAt === undefined ? undefined : Date.now() - taskStartedAt

    petMood.awardTaskProgress(event, key, prevState)

    if (event.state === 'waiting-input') {
      if (prevState !== 'waiting-input') unreadAlerts.scheduleWaitingInputReminder(key)
    } else {
      unreadAlerts.cancelWaitingInputReminder(key)
    }

    if ((event.state === 'success' || event.state === 'error') && prevState !== event.state) {
      if (isQuotaCapableSource(event.source)) deps.markQuotaStale()
      showToast(
        event.source,
        event.project,
        event.state,
        taskElapsedMs,
      )
      unreadAlerts.noteUnreadResult(event.state)
      petMood.rewardOutcome(event.state)
      if (event.state === 'success' && !shouldPlaySuccessSound(taskElapsedMs)) return null
      return AGENT_STATE_PRESENTATION[event.state].cue
    }

    if (event.state !== 'waiting-permission') deps.forgetDismissedNotice(key)

    if (event.state === 'waiting-permission' && prevState !== 'waiting-permission') {
      return AGENT_STATE_PRESENTATION['waiting-permission'].cue
    }

    return null
  }

  function cleanupStale() {
    const now = Date.now()
    const hasPendingPermission = deps.hasPendingPermission()
    for (const session of [...sessionIndex.values()]) {
      const action = sessionLifecycleAction(session, now, { hasPendingPermission })
      if (action === 'remove') {
        // Offline long enough that nobody is looking for it any more.
        sessionIndex.delete(session.key)
        petMood.forgetTask(session.key)
      } else if (action === 'offline') {
        // No update in a long time means the process died without sending a
        // terminal event (Stop/SessionEnd) — treat it as gone rather than
        // letting a stuck thinking/tool-running state mask real sessions.
        session.state = 'offline'
        sessionIndex.updatePriority(session.key, session.state, session.lastSeenAt)
        petMood.forgetTask(session.key)
      }
    }
  }

  // After a renderer reload/crash the in-memory list is empty although agents
  // may still be running. Main keeps a light mirror; merge it in without
  // replaying events (no toasts, mood or sound) and never over live data.
  function restoreSessionSnapshot(entries: unknown): number {
    if (!Array.isArray(entries)) return 0
    const now = Date.now()
    let restored = 0
    for (const raw of entries.slice(0, MAX_SESSION_COUNT)) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Partial<AgentSession>
      if (typeof entry.source !== 'string' || typeof entry.sessionId !== 'string') continue
      if (!isAgentState(entry.state)) continue
      if (typeof entry.lastSeenAt !== 'number' || !Number.isFinite(entry.lastSeenAt)) continue
      if (now - entry.lastSeenAt > SESSION_REMOVE_MS) continue
      const key = getSessionKey(entry.source as AgentSource, entry.sessionId)
      if (sessionIndex.get(key)) continue
      const restoredHost = sanitizeHost(entry.host)
      sessionIndex.upsert({
        key,
        source: entry.source as AgentSource,
        sessionId: entry.sessionId,
        project: typeof entry.project === 'string' ? entry.project : undefined,
        projectId: typeof entry.projectId === 'string' ? entry.projectId : undefined,
        routedPetId: typeof entry.routedPetId === 'string' ? entry.routedPetId : undefined,
        state: entry.state,
        lastSeenAt: entry.lastSeenAt,
        firstSeenAt: typeof entry.firstSeenAt === 'number' && Number.isFinite(entry.firstSeenAt) ? entry.firstSeenAt : entry.lastSeenAt,
        toolName: typeof entry.toolName === 'string' ? entry.toolName : undefined,
        ...(restoredHost ? { host: restoredHost } : {}),
      }, MAX_SESSION_COUNT)
      restored += 1
    }
    return restored
  }

  function handleSuccessTimeout() {
    const now = Date.now()
    for (const session of sessionIndex.values()) {
      if (session.state === 'success') {
        if (now - session.lastSeenAt > SUCCESS_DISPLAY_MS) {
          session.state = 'idle'
          sessionIndex.updatePriority(session.key, session.state, session.lastSeenAt)
        }
      }
    }
  }

  function removeSession(key: string) {
    unreadAlerts.cancelWaitingInputReminder(key)
    sessionIndex.delete(key)
    petMood.forgetTask(key)
  }

  function clearOfflineSessions() {
    for (const session of [...sessionIndex.values()]) {
      if (session.state === 'offline') {
        sessionIndex.delete(session.key)
        petMood.forgetTask(session.key)
      }
    }
  }
  // The broker's `agentId` is the literal AgentSource string for every
  // respond-capable adapter (see electron/permission-adapter-server.ts,
  // which sets `agentId: payload.source` from the same 'opencode-cli' /
  // 'opencode-desktop' values AgentStatusEvent.source uses), so a request
  // and the session it blocks share the exact same getSessionKey().
  function settleWaitingPermission(agentId: string, sessionId: string): void {
    const key = getSessionKey(agentId as AgentSource, sessionId)
    const session = sessionIndex.get(key)
    if (!session || session.state !== 'waiting-permission') return
    // The user (or the broker's own TTL) has resolved this request, but a
    // Codex/Claude session may never send a follow-up hook event — without
    // this, the pet stays stuck showing "Waiting Permission" forever even
    // though nothing is actually waiting anymore (see GH issue #1). This is
    // a local, visual-only fallback: any real event still overwrites it.
    session.state = 'idle'
    session.permissionNotice = undefined
    sessionIndex.updatePriority(key, session.state, session.lastSeenAt)
  }

  function sessionByKey(key: string): AgentSession | undefined {
    return sessionsByKey.get(key)
  }

  /** Runs a jump-back action for one session; the main process holds the path and app id. */
  async function runSessionJump(key: string, action: SessionJumpAction): Promise<SessionJumpResult> {
    const session = sessionIndex.get(key)
    const run = window.electronAPI?.runSessionJump
    if (!session || !run) return { ok: false, error: 'unknown_session' }
    try {
      return await run({ action, source: session.source, sessionId: session.sessionId })
    } catch {
      return { ok: false, error: 'failed' }
    }
  }

  return {
    sessionIndex,
    getSessionKey,
    handleEvent,
    cleanupStale,
    restoreSessionSnapshot,
    handleSuccessTimeout,
    removeSession,
    clearOfflineSessions,
    settleWaitingPermission,
    sessionByKey,
    runSessionJump,
  }
}
