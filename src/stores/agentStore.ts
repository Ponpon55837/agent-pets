import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type {
  AgentSession,
  AgentSource,
  AgentState,
  AgentStatusEvent,
} from '../types/agent'
import { STATE_PRIORITY, SOURCE_FAMILIES, SOURCE_LABELS } from '../types/agent'
import { formatProject } from '../utils/format'

export interface PetEntry {
  id: string
  displayName: string
  folder: string
  builtIn: boolean
}

const SUCCESS_DISPLAY_MS = 4_000
const SESSION_STALE_MS = 15 * 60_000
const MAX_SESSION_COUNT = 200
const QUOTA_REFRESH_MS = 5 * 60_000
const PET_BASE_W = 250 // wide enough for a status line like "OpenCode (CLI+Desktop)"
const PET_BASE_H = 232 // canvas + 1 status line
const STATUS_LINE_EXTRA_H = 22 // per additional status line beyond the first
// The quota tooltip pops open above the status line and is rendered at a
// fixed (unscaled) size regardless of pet size (see DesktopPet.vue), so this
// headroom must stay fixed too rather than scaling with petScale. Without
// it the pet window's transparent canvas is sized exactly to the visible
// sprite + status line with no slack above — fine on macOS, where the
// compositor tolerates content painted slightly outside a layer-backed
// window's bounds, but Windows' layered-window transparency hard-clips to
// the window rectangle, so the tooltip got cut off / visibly broken there.
const QUOTA_TOOLTIP_HEADROOM_H = 190
const TOAST_DISPLAY_MS = 3_500
const MOOD_BASELINE = 10
const MOOD_SYSTEM_VERSION = '2'
const MOOD_SUCCESS_REWARD = 4
const MOOD_ERROR_PENALTY = 6
const MOOD_TOOL_COMPLETIONS_PER_POINT = 2
const MOOD_TOOL_PROGRESS_CAP = 8
const MOOD_TIME_INTERVAL_MS = 5 * 60_000
const MOOD_TIME_PROGRESS_CAP = 4
// Always kept available as the ultimate fallback (see PetAnimation's
// loadImage and the various "|| 'aang-airbender'" defaults below) — so it's
// the one pet that can't be removed/hidden from the list.
const DEFAULT_PET_ID = 'aang-airbender'
const MAX_QUOTA_WINDOWS = 32
const MAX_QUOTA_TEXT_LENGTH = 96

type QuotaUsage = Awaited<ReturnType<NonNullable<Window['electronAPI']>['getQuotaUsage']>>

function normalizeQuotaUsage(value: unknown): QuotaUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) return null
  if (!Array.isArray(raw.providers)) return null

  const providers: QuotaUsage['providers'] = []
  const seen = new Set<string>()
  for (const candidate of raw.providers.slice(0, 2)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const provider = candidate as Record<string, unknown>
    if ((provider.id !== 'codex' && provider.id !== 'claude') || seen.has(provider.id)) continue
    if (typeof provider.name !== 'string' || !Array.isArray(provider.windows)) continue
    const windows: QuotaUsage['providers'][number]['windows'] = []
    for (const candidateWindow of provider.windows.slice(0, MAX_QUOTA_WINDOWS)) {
      if (!candidateWindow || typeof candidateWindow !== 'object' || Array.isArray(candidateWindow)) continue
      const window = candidateWindow as Record<string, unknown>
      if (typeof window.id !== 'string' || typeof window.label !== 'string') continue
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue
      if (typeof window.remainingPercent !== 'number' || !Number.isFinite(window.remainingPercent)) continue
      if (window.usedPercent < 0 || window.usedPercent > 100 || window.remainingPercent < 0 || window.remainingPercent > 100) continue
      const resetsAt = typeof window.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
        ? new Date(window.resetsAt).toISOString()
        : undefined
      windows.push({
        id: window.id.slice(0, MAX_QUOTA_TEXT_LENGTH),
        label: window.label.slice(0, MAX_QUOTA_TEXT_LENGTH),
        usedPercent: window.usedPercent,
        remainingPercent: window.remainingPercent,
        ...(resetsAt ? { resetsAt } : {}),
      })
    }
    seen.add(provider.id)
    providers.push({
      id: provider.id,
      name: provider.name.slice(0, MAX_QUOTA_TEXT_LENGTH),
      ...(typeof provider.plan === 'string' ? { plan: provider.plan.slice(0, MAX_QUOTA_TEXT_LENGTH) } : {}),
      windows,
      ...(typeof provider.error === 'string' ? { error: provider.error.slice(0, 240) } : {}),
    })
  }
  return { updatedAt: new Date(raw.updatedAt).toISOString(), providers }
}

interface MoodTaskProgress {
  startedAt: number
  completedTools: number
  toolPoints: number
  timePoints: number
}

export const useAgentStore = defineStore('agent', () => {
  const sessions = ref<Record<string, AgentSession>>({})
  const isDragging = ref(false)
  const panelView = ref<'sessions' | 'settings'>('sessions')
  const selectedPet = ref<string>(localStorage.getItem('agent-pet-id') || 'aang-airbender')
  const petScale = ref(parseFloat(localStorage.getItem('agent-pet-scale') || '1'))
  const pets = ref<PetEntry[]>([])
  const petsLoaded = ref(false)
  const quotaUsage = ref<QuotaUsage | null>(null)
  const quotaLoading = ref(false)
  const quotaError = ref('')
  let quotaRequestedAt = 0

  // Built-in pets ship as bundled assets, so "removing" one just hides it
  // from your own picker rather than deleting a file — persisted the same
  // way custom-pet deletion is, just via a local id list instead of disk.
  function loadHiddenBuiltins(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem('agent-pet-hidden') || '[]')
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }
  const hiddenBuiltinIds = ref<string[]>(loadHiddenBuiltins())
  const visiblePets = computed(() => pets.value.filter(p => !hiddenBuiltinIds.value.includes(p.id)))

  // Per-family skin overrides (e.g. Codex looks like the cat, Claude looks
  // like the monkey king) — a family with no entry here just falls back to
  // the global `selectedPet`. Keyed by SOURCE_FAMILIES[].key.
  function loadFamilyPetIds(): Record<string, string> {
    try {
      const raw = JSON.parse(localStorage.getItem('agent-pet-family-map') || '{}')
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'string') out[k] = v
        }
        return out
      }
    } catch {}
    return {}
  }
  const familyPetIds = ref<Record<string, string>>(loadFamilyPetIds())

  function setFamilyPet(familyKey: string, petId: string | null) {
    const next = { ...familyPetIds.value }
    if (petId) {
      next[familyKey] = petId
    } else {
      delete next[familyKey]
    }
    familyPetIds.value = next
    localStorage.setItem('agent-pet-family-map', JSON.stringify(next))
  }

  // Falls back to the global default if the family has no override, or its
  // override points at a pet that's since been removed/hidden.
  function getPetForFamily(familyKey: string): string {
    const override = familyPetIds.value[familyKey]
    if (override && visiblePets.value.some(p => p.id === override)) {
      return override
    }
    return selectedPet.value
  }

  const showWizard = ref(false)
  const toast = ref<{ text: string; tone: 'success' | 'error' } | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  const moodTaskProgress = new Map<string, MoodTaskProgress>()

  // Light meta-progression rewards completed tools, sustained work, and
  // successful finishes while errors pull it down. It has no gameplay
  // stakes, just a bit of a "the pet has been having a good day" feel.
  // Resets to baseline at the start of each new (local) day — a fresh start
  // rather than carrying yesterday's mood forward indefinitely.
  function todayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }

  let initialMood = clampMood(parseFloat(localStorage.getItem('agent-pet-mood') || String(MOOD_BASELINE)))
  const needsMoodReset = localStorage.getItem('agent-pet-mood-version') !== MOOD_SYSTEM_VERSION
    || localStorage.getItem('agent-pet-mood-date') !== todayKey()
  if (needsMoodReset) {
    initialMood = MOOD_BASELINE
    localStorage.setItem('agent-pet-mood', String(MOOD_BASELINE))
    localStorage.setItem('agent-pet-mood-date', todayKey())
    localStorage.setItem('agent-pet-mood-version', MOOD_SYSTEM_VERSION)
  }
  const mood = ref(initialMood)

  // Off by default so the app doesn't surprise anyone with sudden audio;
  // opt-in via the Settings toggle.
  const soundEnabled = ref(localStorage.getItem('agent-pet-sound') === '1')

  // Off by default — showing one pet per active tool family is a bigger
  // visual/layout change than the other additions, so it stays opt-in
  // rather than silently changing behavior for people with 2+ tools running.
  const multiPetEnabled = ref(localStorage.getItem('agent-pet-multi') === '1')

  // Off by default — the click/state-change bounce, idle fidget sway, and
  // waiting-permission shake found it distracting. Off leaves the core
  // sprite state animation (and frame speed-up / mood glow) untouched.
  const reactionsEnabled = ref(localStorage.getItem('agent-pet-fx') === '1')

  // Off by default — the completion toast / "what's it doing" bubble.
  const bubbleEnabled = ref(localStorage.getItem('agent-pet-bubble') === '1')

  function clampMood(value: number): number {
    if (Number.isNaN(value)) return MOOD_BASELINE
    return Math.max(0, Math.min(100, value))
  }

  function adjustMood(delta: number) {
    mood.value = clampMood(mood.value + delta)
    localStorage.setItem('agent-pet-mood', String(mood.value))
  }

  // Always sets to the low daily baseline, so the visible energy build-up is
  // earned through successful tasks rather than starting halfway charged.
  function resetMood() {
    mood.value = MOOD_BASELINE
    moodTaskProgress.clear()
    localStorage.setItem('agent-pet-mood', String(MOOD_BASELINE))
    localStorage.setItem('agent-pet-mood-date', todayKey())
    localStorage.setItem('agent-pet-mood-version', MOOD_SYSTEM_VERSION)
  }

  function showToast(source: AgentSource, project: string | undefined, tone: 'success' | 'error') {
    const label = SOURCE_LABELS[source]
    const proj = formatProject(project)
    toast.value = { text: proj ? `${label} · ${proj}` : label, tone }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value = null }, TOAST_DISPLAY_MS)
  }

  function setSoundEnabled(enabled: boolean) {
    soundEnabled.value = enabled
    localStorage.setItem('agent-pet-sound', enabled ? '1' : '0')
  }

  function setMultiPetEnabled(enabled: boolean) {
    multiPetEnabled.value = enabled
    localStorage.setItem('agent-pet-multi', enabled ? '1' : '0')
  }

  function setReactionsEnabled(enabled: boolean) {
    reactionsEnabled.value = enabled
    localStorage.setItem('agent-pet-fx', enabled ? '1' : '0')
  }

  function setBubbleEnabled(enabled: boolean) {
    bubbleEnabled.value = enabled
    localStorage.setItem('agent-pet-bubble', enabled ? '1' : '0')
  }

  function setPet(petId: string) {
    selectedPet.value = petId
    localStorage.setItem('agent-pet-id', petId)
  }

  function setScale(scale: number) {
    petScale.value = scale
    localStorage.setItem('agent-pet-scale', String(scale))
  }

  function getSessionKey(source: AgentSource, sessionId: string): string {
    return `${source}:${sessionId}`
  }

  function isWorkingState(state: AgentState): boolean {
    return state === 'thinking'
      || state === 'tool-running'
      || state === 'waiting-permission'
      || state === 'waiting-input'
  }

  function awardMoodProgress(event: AgentStatusEvent, key: string, prevState?: AgentState) {
    const eventAt = Number.isFinite(event.timestamp) ? event.timestamp : Date.now()
    const explicitTaskStart = event.originalEvent === 'UserPromptSubmit'
    const resumedFromTerminal = prevState === 'idle'
      || prevState === 'success'
      || prevState === 'error'
      || prevState === 'offline'

    if (
      explicitTaskStart
      || (isWorkingState(event.state) && (!moodTaskProgress.has(key) || resumedFromTerminal))
    ) {
      moodTaskProgress.set(key, {
        startedAt: eventAt,
        completedTools: 0,
        toolPoints: 0,
        timePoints: 0,
      })
    }

    const progress = moodTaskProgress.get(key)
    if (!progress) return

    let reward = 0
    if (prevState === 'tool-running' && event.state === 'thinking') {
      progress.completedTools += 1
      const earnedToolPoints = Math.min(
        MOOD_TOOL_PROGRESS_CAP,
        Math.floor(progress.completedTools / MOOD_TOOL_COMPLETIONS_PER_POINT),
      )
      reward += earnedToolPoints - progress.toolPoints
      progress.toolPoints = earnedToolPoints
    }

    const elapsed = Math.max(0, eventAt - progress.startedAt)
    const earnedTimePoints = Math.min(
      MOOD_TIME_PROGRESS_CAP,
      Math.floor(elapsed / MOOD_TIME_INTERVAL_MS),
    )
    reward += earnedTimePoints - progress.timePoints
    progress.timePoints = earnedTimePoints

    if (reward > 0) adjustMood(reward)

    if (event.state === 'success' || event.state === 'error' || event.state === 'idle' || event.state === 'offline') {
      moodTaskProgress.delete(key)
    }
  }

  // Returns which (if any) sound cue this event is worth playing, so the
  // caller (App.vue) can decide whether/where to actually play it — this
  // store instance is shared by both the pet and panel windows, and audio
  // must only come from one of them or it plays twice.
  function handleEvent(event: AgentStatusEvent): 'success' | 'error' | 'waiting-permission' | null {
    const key = getSessionKey(event.source, event.sessionId)
    const existing = sessions.value[key]
    const prevState = existing?.state

    if (event.originalEvent === 'AgentPetsIntegrationTest' && event.state === 'offline') {
      removeSession(key)
      return null
    }

    if (existing) {
      existing.state = event.state
      existing.lastSeenAt = event.timestamp
      existing.project = event.project
      existing.toolName = event.toolName
    } else {
      const allSessions = Object.values(sessions.value)
      if (allSessions.length >= MAX_SESSION_COUNT) {
        const evictionCandidate = allSessions
          .sort((a, b) => {
            const offlineDelta = Number(a.state !== 'offline') - Number(b.state !== 'offline')
            return offlineDelta || a.lastSeenAt - b.lastSeenAt
          })[0]
        if (evictionCandidate) removeSession(evictionCandidate.key)
      }
      sessions.value[key] = {
        key,
        source: event.source,
        sessionId: event.sessionId,
        project: event.project,
        state: event.state,
        lastSeenAt: event.timestamp,
        toolName: event.toolName,
      }
    }

    awardMoodProgress(event, key, prevState)

    if ((event.state === 'success' || event.state === 'error') && prevState !== event.state) {
      showToast(event.source, event.project, event.state)
      adjustMood(event.state === 'success' ? MOOD_SUCCESS_REWARD : -MOOD_ERROR_PENALTY)
      return event.state
    }

    if (event.state === 'waiting-permission' && prevState !== 'waiting-permission') {
      return 'waiting-permission'
    }

    return null
  }

  function cleanupStale() {
    const now = Date.now()
    for (const key of Object.keys(sessions.value)) {
      const session = sessions.value[key]
      if (now - session.lastSeenAt > SESSION_STALE_MS && session.state !== 'offline') {
        // No update in a long time means the process died without sending a
        // terminal event (Stop/SessionEnd) — treat it as gone rather than
        // letting a stuck thinking/tool-running state mask real sessions.
        session.state = 'offline'
        moodTaskProgress.delete(key)
      }
    }
  }

  function handleSuccessTimeout() {
    const now = Date.now()
    for (const key of Object.keys(sessions.value)) {
      const session = sessions.value[key]
      if (session.state === 'success') {
        if (now - session.lastSeenAt > SUCCESS_DISPLAY_MS) {
          session.state = 'idle'
        }
      }
    }
  }

  function removeSession(key: string) {
    delete sessions.value[key]
    moodTaskProgress.delete(key)
  }

  function clearOfflineSessions() {
    for (const key of Object.keys(sessions.value)) {
      if (sessions.value[key].state === 'offline') {
        delete sessions.value[key]
        moodTaskProgress.delete(key)
      }
    }
  }

  const activeSessions = computed(() => {
    return Object.values(sessions.value).filter(
      (s) => s.state !== 'offline'
    )
  })

  const hasQuotaCapableSessions = computed(() => activeSessions.value.some(
    (session) => session.source === 'codex'
      || session.source === 'codex-desktop'
      || session.source === 'claude'
      || session.source === 'claude-desktop',
  ))

  const quotaByFamily = computed<Record<string, { label: string; remainingPercent: number; resetsAt?: string }>>(() => {
    const result: Record<string, { label: string; remainingPercent: number; resetsAt?: string }> = {}
    for (const provider of quotaUsage.value?.providers ?? []) {
      if (provider.error || (provider.id !== 'codex' && provider.id !== 'claude')) continue
      // Prefer the short session window. Some Codex accounts currently only
      // receive a weekly window, so fall back instead of hiding the meter.
      const quotaWindow = provider.windows.find(
        (window) => window.id === 'session' || window.label.toLowerCase() === 'session',
      ) ?? provider.windows.find(
        (window) => window.id === 'weekly' || window.label.toLowerCase() === 'weekly',
      ) ?? provider.windows[0]
      if (!quotaWindow || !Number.isFinite(quotaWindow.remainingPercent)) continue
      result[provider.id] = {
        label: quotaWindow.label,
        remainingPercent: Math.max(0, Math.min(100, quotaWindow.remainingPercent)),
        ...(quotaWindow.resetsAt ? { resetsAt: quotaWindow.resetsAt } : {}),
      }
    }
    return result
  })

  function setQuotaUsage(usage: unknown): boolean {
    const normalized = normalizeQuotaUsage(usage)
    if (!normalized) return false
    quotaUsage.value = normalized
    quotaError.value = ''
    return true
  }

  async function refreshQuota(force = false) {
    if (!window.electronAPI?.getQuotaUsage || quotaLoading.value) return quotaUsage.value
    const now = Date.now()
    if (!force && quotaUsage.value && now - quotaRequestedAt < QUOTA_REFRESH_MS) return quotaUsage.value
    quotaLoading.value = true
    quotaError.value = ''
    quotaRequestedAt = now
    try {
      const usage = await window.electronAPI.getQuotaUsage(force)
      if (!setQuotaUsage(usage)) {
        quotaError.value = 'Quota service returned invalid data.'
      }
      return quotaUsage.value
    } catch (error) {
      quotaError.value = error instanceof Error ? error.message : 'Could not load usage.'
      return quotaUsage.value
    } finally {
      quotaLoading.value = false
    }
  }

  const hasSuccessSessions = computed(() => {
    return activeSessions.value.some((s) => s.state === 'success')
  })

  // One line per tool family (CLI + Desktop combined), only shown while that
  // family has an active session — up to SOURCE_FAMILIES.length lines total.
  // `variants` records which of CLI/Desktop are actually active so the line
  // can still say which one, even though they share a row.
  const familyLines = computed(() => {
    return SOURCE_FAMILIES.map((family) => {
      const familySessions = activeSessions.value.filter((s) => family.sources.includes(s.source))
      if (familySessions.length === 0) return null

      const top = familySessions.reduce((highest, current) => {
        const highestPriority = STATE_PRIORITY[highest.state] ?? 0
        const currentPriority = STATE_PRIORITY[current.state] ?? 0
        return currentPriority > highestPriority ? current : highest
      })

      const variants = family.sources
        .filter((source) => familySessions.some((s) => s.source === source))
        .map((source) => (source.includes('desktop') ? 'Desktop' : 'CLI'))

      return {
        key: family.key,
        label: family.label,
        variants,
        state: top.state,
        project: familySessions.length === 1 ? top.project : undefined,
        count: familySessions.length,
        since: top.lastSeenAt,
        petId: getPetForFamily(family.key),
      }
    }).filter((line): line is NonNullable<typeof line> => line !== null)
  })

  // When more than one tool family is active at once and the user has opted
  // in, the pet window shows one small pet per family side by side instead
  // of collapsing them all into a single highest-priority pet.
  const isMultiPet = computed(() => multiPetEnabled.value && familyLines.value.length > 1)

  const MULTI_PET_CELL_W = 204 // sprite cell (192) + a small gap
  // The quota tooltip (DesktopPet.vue) shrinks to its content but is capped
  // at 244px regardless of pet size, same reasoning as
  // QUOTA_TOOLTIP_HEADROOM_H below — the pet window must stay at least that
  // wide (plus a little slack either side of the centered tooltip) or a
  // small pet size clips the tooltip at the window edge.
  const QUOTA_TOOLTIP_MIN_W = 260
  const scaledW = computed(() => {
    if (isMultiPet.value) {
      const count = familyLines.value.length
      return Math.round((count * MULTI_PET_CELL_W + 16) * petScale.value)
    }
    return Math.max(Math.round(PET_BASE_W * petScale.value), QUOTA_TOOLTIP_MIN_W)
  })
  const scaledH = computed(() => {
    const lineCount = Math.max(1, familyLines.value.length)
    // Multi-pet mode lays families out side by side with one short label
    // each, instead of stacking a status line per family, so it doesn't
    // need the per-line height growth the single-pet mode does.
    const extra = isMultiPet.value ? 0 : (lineCount - 1) * STATUS_LINE_EXTRA_H
    // The toast/activity bubble deliberately does NOT grow the window here
    // (see DesktopPet.vue) — it overlays the existing canvas instead, so
    // showing/hiding it never triggers a resize+reposition of the window.
    // The tooltip headroom below is unscaled and always reserved (rather
    // than added only while a tooltip is open) for the same reason: growing
    // the window on hover would reposition/animate it, which is distracting
    // for a "just glance at it" hover interaction.
    return Math.round((PET_BASE_H + extra) * petScale.value) + QUOTA_TOOLTIP_HEADROOM_H
  })

  const highestPrioritySession = computed<AgentSession | null>(() => {
    const active = activeSessions.value
    if (active.length === 0) return null

    return active.reduce((highest, current) => {
      const highestPriority = STATE_PRIORITY[highest.state] ?? 0
      const currentPriority = STATE_PRIORITY[current.state] ?? 0
      return currentPriority > highestPriority ? current : highest
    })
  })

  const currentState = computed<AgentState>(() => {
    return highestPrioritySession.value?.state ?? 'offline'
  })

  const currentSource = computed(() => {
    return highestPrioritySession.value?.source ?? null
  })

  // Reverse-lookup from the currently-controlling source into its tool
  // family for multi-pet skin selection.
  const currentFamilyKey = computed<string | null>(() => {
    const source = currentSource.value
    if (!source) return null
    return SOURCE_FAMILIES.find(f => f.sources.includes(source))?.key ?? null
  })

  const activePetId = computed(() => {
    // Per-family skins are a multi-pet feature. When that mode is off, keep
    // the original single-pet behavior: always render the global selection.
    if (!multiPetEnabled.value) return selectedPet.value
    return currentFamilyKey.value ? getPetForFamily(currentFamilyKey.value) : selectedPet.value
  })

  // Live "what's it doing right now" bubble text — only meaningful while a
  // tool is actively running and the hook payload included a tool name.
  const activityText = computed<string | null>(() => {
    const s = highestPrioritySession.value
    if (!s || s.state !== 'tool-running' || !s.toolName) return null
    return s.toolName
  })

  // The panel lives in its own always-on-top window (see electron/main.ts),
  // so opening/closing/resizing it never touches the pet window's bounds.
  function togglePanel() {
    window.electronAPI?.togglePanel()
  }

  function closePanel() {
    showWizard.value = false
    window.electronAPI?.hidePanel()
  }

  function openSettings() {
    panelView.value = 'settings'
    window.electronAPI?.resizePanel(420)
  }

  function backToSessions() {
    panelView.value = 'sessions'
    showWizard.value = false
    window.electronAPI?.resizePanel(380)
  }

  // Called by electron/main.ts whenever the panel window transitions from
  // hidden to visible, so it always opens back on the Sessions view.
  function handlePanelOpened() {
    panelView.value = 'sessions'
    showWizard.value = false
  }

  function resizePetWindow() {
    window.electronAPI?.resizeWindow(scaledW.value, scaledH.value)
  }

  // Grows/shrinks the pet window whenever scale or active status-line count
  // changes — firing from either window's store instance is harmless, since
  // main process just re-applies the same bounds to the (single) pet window.
  watch([scaledW, scaledH], resizePetWindow, { immediate: true })

  async function loadPets() {
    try {
      const list = await window.electronAPI?.loadPets()
      if (list) {
        pets.value = list
      }
    } finally {
      petsLoaded.value = true
    }
  }

  async function renamePet(petId: string, newName: string) {
    const ok = await window.electronAPI?.renameCustomPet(petId, newName)
    if (ok) {
      const pet = pets.value.find(p => p.id === petId)
      if (pet) pet.displayName = newName
    }
  }

  async function removePet(petId: string) {
    if (petId === DEFAULT_PET_ID) return

    const pet = pets.value.find(p => p.id === petId)
    if (pet?.builtIn) {
      if (!hiddenBuiltinIds.value.includes(petId)) {
        hiddenBuiltinIds.value = [...hiddenBuiltinIds.value, petId]
        localStorage.setItem('agent-pet-hidden', JSON.stringify(hiddenBuiltinIds.value))
      }
    } else {
      await window.electronAPI?.removeCustomPet(petId)
      pets.value = pets.value.filter(p => p.id !== petId)
    }

    if (selectedPet.value === petId) {
      setPet(visiblePets.value[0]?.id || DEFAULT_PET_ID)
    }

    for (const [familyKey, assignedId] of Object.entries(familyPetIds.value)) {
      if (assignedId === petId) {
        setFamilyPet(familyKey, null)
      }
    }
  }

  return {
    sessions,
    isDragging,
    panelView,
    selectedPet,
    petScale,
    scaledW,
    scaledH,
    pets,
    visiblePets,
    familyPetIds,
    petsLoaded,
    quotaUsage,
    quotaLoading,
    quotaError,
    quotaByFamily,
    hasQuotaCapableSessions,
    defaultPetId: DEFAULT_PET_ID,
    showWizard,
    toast,
    mood,
    soundEnabled,
    multiPetEnabled,
    reactionsEnabled,
    bubbleEnabled,
    isMultiPet,
    activeSessions,
    hasSuccessSessions,
    familyLines,
    highestPrioritySession,
    currentState,
    currentSource,
    currentFamilyKey,
    activePetId,
    activityText,
    handleEvent,
    cleanupStale,
    handleSuccessTimeout,
    removeSession,
    clearOfflineSessions,
    togglePanel,
    closePanel,
    openSettings,
    backToSessions,
    handlePanelOpened,
    setPet,
    setScale,
    setSoundEnabled,
    setMultiPetEnabled,
    setReactionsEnabled,
    setBubbleEnabled,
    setFamilyPet,
    getPetForFamily,
    resetMood,
    resizePetWindow,
    loadPets,
    setQuotaUsage,
    refreshQuota,
    renamePet,
    removePet,
  }
})
