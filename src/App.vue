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
let cleanupQuotaUpdated: (() => void) | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let successTimer: ReturnType<typeof setInterval> | null = null
let quotaTimer: ReturnType<typeof setInterval> | null = null
let petMousePassthrough = false

function isOpaqueCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  const x = Math.floor((clientX - rect.left) * canvas.width / rect.width)
  const y = Math.floor((clientY - rect.top) * canvas.height / rect.height)
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false

  try {
    return (canvas.getContext('2d')?.getImageData(x, y, 1, 1).data[3] ?? 0) > 16
  } catch {
    // A custom file URL can make a canvas unreadable on some platforms.
    // Keep that canvas usable rather than making the whole pet click-through.
    return true
  }
}

function isPetHitTarget(clientX: number, clientY: number): boolean {
  const target = document.elementFromPoint(clientX, clientY)
  if (!(target instanceof Element)) return false
  if (target.closest('[data-pet-hit-target="solid"]')) return true

  const canvas = target.closest('canvas.pet-canvas')
  return canvas instanceof HTMLCanvasElement && isOpaqueCanvasPoint(canvas, clientX, clientY)
}

function handlePetMouseMove(event: MouseEvent) {
  const ignore = !store.isDragging && !isPetHitTarget(event.clientX, event.clientY)
  if (ignore === petMousePassthrough) return
  petMousePassthrough = ignore
  window.electronAPI?.setMousePassthrough(ignore)
}

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
  } else if (e.key === 'agent-pet-family-map') {
    try {
      const parsed = e.newValue ? JSON.parse(e.newValue) : {}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        store.familyPetIds = parsed
      }
    } catch {}
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
  if (electronAPI?.onQuotaUsageUpdated) {
    cleanupQuotaUpdated = electronAPI.onQuotaUsageUpdated((usage: unknown) => {
      store.setQuotaUsage(usage)
    })
  }
  if (!isPanelWindow && electronAPI?.setMousePassthrough) {
    window.addEventListener('mousemove', handlePetMouseMove, true)
  }

  window.addEventListener('storage', handleStorage)

  staleTimer = setInterval(() => {
    store.cleanupStale()
  }, 60_000)
})

watch(() => store.petScale, (v) => {
  document.documentElement.style.setProperty('--pet-scale', String(v))
})

// The compact meter only needs quota while a Codex/Claude family is active.
// Poll slowly, and let the main-process cache coalesce requests from the pet
// and panel renderer. Manual refreshes are broadcast back to both windows.
watch(() => store.hasQuotaCapableSessions, (active) => {
  if (quotaTimer) {
    clearInterval(quotaTimer)
    quotaTimer = null
  }
  if (!active || isPanelWindow) return
  void store.refreshQuota()
  quotaTimer = setInterval(() => {
    void store.refreshQuota()
  }, 5 * 60_000)
}, { immediate: true })

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
  cleanupQuotaUpdated?.()
  window.removeEventListener('mousemove', handlePetMouseMove, true)
  window.removeEventListener('storage', handleStorage)
  if (staleTimer) clearInterval(staleTimer)
  if (successTimer) clearInterval(successTimer)
  if (quotaTimer) clearInterval(quotaTimer)
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

/* One unobtrusive overlay-style scrollbar across the whole app. Keeping this
   global also covers modal surfaces such as Setup Wizard and future scrollers.
   Avoid standard scrollbar properties because Chromium on Windows otherwise
   falls back to the native track and arrow buttons. */
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
  background: transparent;
}

*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  background-clip: padding-box;
}

*::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.34);
  background-clip: padding-box;
}

*::-webkit-scrollbar-button {
  -webkit-appearance: none;
  display: none;
  width: 0;
  height: 0;
  background: transparent;
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
