<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from './stores/agentStore'
import DesktopPet from './components/DesktopPet.vue'
import StatusPanel from './components/StatusPanel.vue'
import SetupWizard from './components/SetupWizard.vue'
import { playCue } from './utils/sound'

const store = useAgentStore()
const isPanelWindow = window.location.hash === '#panel'

let cleanupListener: (() => void) | null = null
let cleanupPanelOpened: (() => void) | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let successTimer: ReturnType<typeof setInterval> | null = null

// Pet and panel are separate windows/renderer processes, each with its own
// Pinia store instance. selectedPet/petScale are user choices made in the
// panel's Settings view but need to reach the pet window — both windows
// share one localStorage (same origin), so a plain `storage` event (fired
// in every OTHER same-origin window when one of them writes to it) is all
// that's needed to keep them in sync, no custom IPC round-trip required.
function handleStorage(e: StorageEvent) {
  if (e.key === 'agent-pet-scale' && e.newValue) {
    store.petScale = parseFloat(e.newValue)
  } else if (e.key === 'agent-pet-id' && e.newValue) {
    store.loadPets().then(() => {
      store.selectedPet = e.newValue as string
    })
  } else if (e.key === 'agent-pet-sound') {
    store.soundEnabled = e.newValue === '1'
  } else if (e.key === 'agent-pet-multi') {
    store.multiPetEnabled = e.newValue === '1'
  } else if (e.key === 'agent-pet-fx') {
    store.reactionsEnabled = e.newValue === '1'
  } else if (e.key === 'agent-pet-bubble') {
    store.bubbleEnabled = e.newValue === '1'
  } else if (e.key === 'agent-pet-mood' && e.newValue) {
    store.mood = parseFloat(e.newValue)
  }
}

onMounted(() => {
  document.documentElement.style.setProperty('--pet-scale', String(store.petScale))
  document.documentElement.style.setProperty('--pet-w', store.scaledW + 'px')

  const electronAPI = (window as any).electronAPI
  if (electronAPI?.onAgentStatusEvent) {
    cleanupListener = electronAPI.onAgentStatusEvent((event: unknown) => {
      const cue = store.handleEvent(event as any)
      // Both windows' stores process every event identically, so only the
      // pet window actually plays audio — otherwise it'd sound twice.
      if (cue && !isPanelWindow && store.soundEnabled) {
        playCue(cue)
      }
    })
  }
  if (isPanelWindow && electronAPI?.onPanelOpened) {
    cleanupPanelOpened = electronAPI.onPanelOpened(() => {
      store.handlePanelOpened()
    })
  }

  window.addEventListener('storage', handleStorage)

  staleTimer = setInterval(() => {
    store.cleanupStale()
  }, 60_000)
})

watch(() => store.petScale, (v) => {
  document.documentElement.style.setProperty('--pet-scale', String(v))
})

watch(() => store.scaledW, (w) => {
  document.documentElement.style.setProperty('--pet-w', w + 'px')
})

// Only tick the success->idle timeout while something is actually counting
// down, instead of waking up every second for the app's whole lifetime.
watch(() => store.hasSuccessSessions, (active) => {
  if (active && !successTimer) {
    successTimer = setInterval(() => {
      store.handleSuccessTimeout()
    }, 1_000)
  } else if (!active && successTimer) {
    clearInterval(successTimer)
    successTimer = null
  }
}, { immediate: true })

onUnmounted(() => {
  cleanupListener?.()
  cleanupPanelOpened?.()
  window.removeEventListener('storage', handleStorage)
  if (staleTimer) clearInterval(staleTimer)
  if (successTimer) clearInterval(successTimer)
})
</script>

<template>
  <div class="app-container">
    <template v-if="isPanelWindow">
      <StatusPanel />
      <Transition name="wizard">
        <SetupWizard v-if="store.showWizard" @close="store.showWizard = false" />
      </Transition>
    </template>
    <DesktopPet v-else />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
}

.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}

.wizard-enter-active,
.wizard-leave-active {
  transition: all 0.2s ease;
}

.wizard-enter-from,
.wizard-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
