import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type {
  AgentSession,
  AgentSource,
  AgentState,
  AgentStatusEvent,
} from '../types/agent'
import { STATE_PRIORITY, SOURCE_FAMILIES } from '../types/agent'

export interface PetEntry {
  id: string
  displayName: string
  folder: string
  builtIn: boolean
}

const SUCCESS_DISPLAY_MS = 4_000
const SESSION_STALE_MS = 15 * 60_000
const PET_BASE_W = 250 // wide enough for a status line like "OpenCode (CLI+Desktop)"
const PET_BASE_H = 232 // canvas + 1 status line
const STATUS_LINE_EXTRA_H = 22 // per additional status line beyond the first

export const useAgentStore = defineStore('agent', () => {
  const sessions = ref<Record<string, AgentSession>>({})
  const isDragging = ref(false)
  const panelView = ref<'sessions' | 'settings'>('sessions')
  const selectedPet = ref<string>(localStorage.getItem('agent-pet-id') || 'aang-airbender')
  const petScale = ref(parseFloat(localStorage.getItem('agent-pet-scale') || '1'))
  const pets = ref<PetEntry[]>([])
  const petsLoaded = ref(false)
  const showWizard = ref(false)

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

  function handleEvent(event: AgentStatusEvent) {
    const key = getSessionKey(event.source, event.sessionId)
    const existing = sessions.value[key]

    if (existing) {
      existing.state = event.state
      existing.lastSeenAt = event.timestamp
      existing.project = event.project
    } else {
      sessions.value[key] = {
        key,
        source: event.source,
        sessionId: event.sessionId,
        project: event.project,
        state: event.state,
        lastSeenAt: event.timestamp,
      }
    }
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
  }

  const activeSessions = computed(() => {
    return Object.values(sessions.value).filter(
      (s) => s.state !== 'offline'
    )
  })

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
      }
    }).filter((line): line is NonNullable<typeof line> => line !== null)
  })

  const scaledW = computed(() => Math.round(PET_BASE_W * petScale.value))
  const scaledH = computed(() => {
    const lineCount = Math.max(1, familyLines.value.length)
    const extra = (lineCount - 1) * STATUS_LINE_EXTRA_H
    return Math.round((PET_BASE_H + extra) * petScale.value)
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
    await window.electronAPI?.removeCustomPet(petId)
    pets.value = pets.value.filter(p => p.id !== petId)
    if (selectedPet.value === petId) {
      setPet(pets.value[0]?.id || 'aang-airbender')
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
    petsLoaded,
    showWizard,
    activeSessions,
    hasSuccessSessions,
    familyLines,
    highestPrioritySession,
    currentState,
    currentSource,
    handleEvent,
    cleanupStale,
    handleSuccessTimeout,
    removeSession,
    togglePanel,
    closePanel,
    openSettings,
    backToSessions,
    handlePanelOpened,
    setPet,
    setScale,
    resizePetWindow,
    loadPets,
    renamePet,
    removePet,
  }
})
