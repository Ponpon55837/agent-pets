import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AgentSession,
  AgentSource,
  AgentState,
  AgentStatusEvent,
} from '../types/agent'
import { STATE_PRIORITY } from '../types/agent'

export interface PetEntry {
  id: string
  displayName: string
  folder: string
  builtIn: boolean
}

const SUCCESS_DISPLAY_MS = 4_000
const SESSION_STALE_MS = 15 * 60_000
const PET_BASE_W = 210
const PET_BASE_H = 230

export const useAgentStore = defineStore('agent', () => {
  const sessions = ref<Record<string, AgentSession>>({})
  const showPanel = ref(false)
  const isDragging = ref(false)
  const panelView = ref<'sessions' | 'settings'>('sessions')
  const selectedPet = ref<string>(localStorage.getItem('agent-pet-id') || 'aang-airbender')
  const petScale = ref(parseFloat(localStorage.getItem('agent-pet-scale') || '1'))
  const pets = ref<PetEntry[]>([])
  const showWizard = ref(false)

  const scaledW = computed(() => Math.round(PET_BASE_W * petScale.value))
  const scaledH = computed(() => Math.round(PET_BASE_H * petScale.value))

  function setPet(petId: string) {
    selectedPet.value = petId
    localStorage.setItem('agent-pet-id', petId)
  }

  function setScale(scale: number) {
    petScale.value = scale
    localStorage.setItem('agent-pet-scale', String(scale))
    resizeForContent()
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
      if (now - session.lastSeenAt > SESSION_STALE_MS) {
        if (session.state === 'success') {
          session.state = 'idle'
        }
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

  function openPanel() {
    showPanel.value = true
    panelView.value = 'sessions'
    resizeForContent()
  }

  function closePanel() {
    showPanel.value = false
    showWizard.value = false
    resizeForContent()
  }

  function openSettings() {
    panelView.value = 'settings'
    resizeForContent()
  }

  function backToSessions() {
    panelView.value = 'sessions'
    showWizard.value = false
    resizeForContent()
  }

  function resizeForContent() {
    if (showPanel.value) {
      const h = panelView.value === 'settings' ? 420 : 380
      window.electronAPI?.resizeWindow(320, h)
    } else {
      window.electronAPI?.resizeWindow(scaledW.value, scaledH.value)
    }
  }

  async function loadPets() {
    const list = await window.electronAPI?.loadPets()
    if (list) {
      pets.value = list
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
    showPanel,
    isDragging,
    panelView,
    selectedPet,
    petScale,
    scaledW,
    scaledH,
    pets,
    showWizard,
    activeSessions,
    highestPrioritySession,
    currentState,
    currentSource,
    handleEvent,
    cleanupStale,
    handleSuccessTimeout,
    removeSession,
    openPanel,
    closePanel,
    openSettings,
    backToSessions,
    setPet,
    setScale,
    resizeForContent,
    loadPets,
    removePet,
  }
})
