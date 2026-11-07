<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import DesktopPet from '@/components/DesktopPet.vue'
import StatusPanel from '@/components/StatusPanel.vue'
import SetupWizard from '@/components/SetupWizard.vue'
import ProjectMcpPanel from '@/components/ProjectMcpPanel.vue'
import { playCue, type SoundCue } from '@/utils/sound'
import type { DesktopPreferences } from '@/types/desktop'
import type { AchievementSnapshot, AchievementUnlock } from '@/types/achievement'
import { setLocale as applyLocale } from '@/i18n'
import { HIT_DILATE_PX, decidePassthrough, hasOpaquePixel } from '@/utils/pet-hit-test'

const store = useAgentStore()
const isPanelWindow = window.location.hash === '#panel'

let cleanupListener: (() => void) | null = null
let cleanupPanelOpened: (() => void) | null = null
let cleanupPanelOpenSettings: (() => void) | null = null
let cleanupDesktopPreferences: (() => void) | null = null
let cleanupPetWindowMode: (() => void) | null = null
let cleanupProgression: (() => void) | null = null
let cleanupAchievements: (() => void) | null = null
let cleanupAchievementUnlock: (() => void) | null = null
let cleanupQuotaUpdated: (() => void) | null = null
let cleanupPermissionRequests: (() => void) | null = null
let cleanupPresentationIntent: (() => void) | null = null
let cleanupPluginFeedItem: (() => void) | null = null
let cleanupPluginFeedUnreadCount: (() => void) | null = null
let cleanupPluginSkinsChanged: (() => void) | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let successTimer: ReturnType<typeof setInterval> | null = null
let quotaTimer: ReturnType<typeof setInterval> | null = null
let quotaSettleTimer: ReturnType<typeof setTimeout> | null = null
let lastSettleRefreshAt = 0
let petMousePassthrough = false

function stopRecurringTimers(): void {
  if (staleTimer) clearInterval(staleTimer)
  if (successTimer) clearInterval(successTimer)
  if (quotaTimer) clearInterval(quotaTimer)
  if (quotaSettleTimer) clearTimeout(quotaSettleTimer)
  staleTimer = null
  successTimer = null
  quotaTimer = null
  quotaSettleTimer = null
}

function syncRecurringTimers(): void {
  if (document.hidden) {
    stopRecurringTimers()
    return
  }
  if (!staleTimer) {
    staleTimer = setInterval(() => store.cleanupStale(), 60_000)
  }
  if (!isPanelWindow && store.hasQuotaCapableSessions && !quotaTimer) {
    quotaTimer = setInterval(() => { void store.refreshQuota() }, store.quotaRefreshMs)
  }
  if (store.hasSuccessSessions && !successTimer) {
    successTimer = setInterval(() => store.handleSuccessTimeout(), 1_000)
  }
}

function onDocumentVisibilityChange(): void {
  if (document.hidden) {
    stopRecurringTimers()
    return
  }
  store.cleanupStale()
  store.handleSuccessTimeout()
  if (!isPanelWindow && store.hasQuotaCapableSessions) void store.refreshQuota()
  syncRecurringTimers()
}

function isOpaqueCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  const x = Math.floor((clientX - rect.left) * canvas.width / rect.width)
  const y = Math.floor((clientY - rect.top) * canvas.height / rect.height)
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false

  try {
    // Sample a small neighbourhood rather than one pixel so gaps between legs
    // and arms do not make the pet impossible to grab.
    const left = Math.max(0, x - HIT_DILATE_PX)
    const top = Math.max(0, y - HIT_DILATE_PX)
    const right = Math.min(canvas.width, x + HIT_DILATE_PX + 1)
    const bottom = Math.min(canvas.height, y + HIT_DILATE_PX + 1)
    const block = canvas.getContext('2d')?.getImageData(left, top, right - left, bottom - top).data
    return block ? hasOpaquePixel(block) : false
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

// The last cursor position inside the window, so the decision can be redone
// when something moves under a motionless cursor (bubble appears, pet walks).
let lastPointer: { x: number; y: number } | null = null
let lastPointerAt = 0
let passthroughSentAt = 0
let reevaluateFrame: number | null = null
let layoutObserver: ResizeObserver | null = null
let layoutMutationObserver: MutationObserver | null = null
const POINTER_FRESH_MS = 4_000

function sendPassthrough(ignore: boolean): void {
  const decision = decidePassthrough(ignore, petMousePassthrough, passthroughSentAt, performance.now())
  if (!decision.send) return
  petMousePassthrough = decision.next
  passthroughSentAt = performance.now()
  window.electronAPI?.setMousePassthrough(ignore)
}

function evaluatePointer(clientX: number, clientY: number): void {
  if (store.petWindowMode.mode === 'edge') {
    window.electronAPI?.notifyPetHover()
    sendPassthrough(false)
    return
  }
  sendPassthrough(!store.isDragging && !isPetHitTarget(clientX, clientY))
}

function handlePetMouseMove(event: MouseEvent) {
  lastPointer = { x: event.clientX, y: event.clientY }
  lastPointerAt = performance.now()
  evaluatePointer(event.clientX, event.clientY)
}

function scheduleReevaluate(): void {
  if (reevaluateFrame !== null || !lastPointer) return
  if (performance.now() - lastPointerAt > POINTER_FRESH_MS) return
  reevaluateFrame = requestAnimationFrame(() => {
    reevaluateFrame = null
    if (!lastPointer || store.petWindowMode.mode === 'edge') return
    evaluatePointer(lastPointer.x, lastPointer.y)
  })
}

// Mode changes re-apply native window bounds in main, which also resets mouse
// handling to "interactive"; forget what we think we sent.
watch(() => store.petWindowMode.mode, () => {
  petMousePassthrough = false
  passthroughSentAt = 0
  scheduleReevaluate()
})

function startLayoutWatch(): void {
  const root = document.querySelector('.app-container')
  if (!root) return
  layoutObserver = new ResizeObserver(scheduleReevaluate)
  layoutObserver.observe(root)
  layoutMutationObserver = new MutationObserver(scheduleReevaluate)
  layoutMutationObserver.observe(root, { childList: true, subtree: true })
}

function stopLayoutWatch(): void {
  layoutObserver?.disconnect()
  layoutMutationObserver?.disconnect()
  layoutObserver = null
  layoutMutationObserver = null
  if (reevaluateFrame !== null) cancelAnimationFrame(reevaluateFrame)
  reevaluateFrame = null
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
      void store.setProgressionPet(e.newValue as string)
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
    store.reactionsEnabled = e.newValue !== '0'
  } else if (e.key === 'agent-pet-bubble') {
    store.bubbleEnabled = e.newValue !== '0'
  } else if (e.key === 'agent-pet-ambient') {
    store.ambientEnabled = e.newValue === '1'
  } else if (e.key === 'agent-pet-activity') {
    store.activityBubbleEnabled = e.newValue === '1'
  } else if (e.key === 'agent-pet-mood' && e.newValue) {
    store.mood = parseFloat(e.newValue)
  } else if (e.key === 'agent-pet-mood-visuals') {
    store.moodVisualsEnabled = e.newValue !== '0'
  } else if (e.key === 'agent-pet-locale' && e.newValue) {
    applyLocale(e.newValue)
  }
}

// Both windows' stores process every event identically, so only the pet
// window actually plays audio — otherwise it'd sound twice.
function playCueIfAllowed(cue: SoundCue): void {
  if (
    !isPanelWindow
    && store.desktopPreferencesReady
    && store.soundEnabled
    && !store.dndEnabled
  ) {
    playCue(cue)
  }
}

onMounted(() => {
  store.setCueSink(playCueIfAllowed)
  document.documentElement.style.setProperty('--pet-scale', String(store.petScale))
  document.documentElement.style.setProperty('--pet-w', store.scaledW + 'px')

  const electronAPI = (window as any).electronAPI
  if (electronAPI?.onAgentStatusEvent) {
    cleanupListener = electronAPI.onAgentStatusEvent((event: unknown) => {
      const cue = store.handleEvent(event as any)
      if (cue) playCueIfAllowed(cue)
    })
  }
  if (electronAPI?.onPresentationIntent) {
    cleanupPresentationIntent = electronAPI.onPresentationIntent((intent: unknown) => {
      store.handlePresentationIntent(intent)
    })
  }
  if (electronAPI?.onPluginFeedItem) {
    cleanupPluginFeedItem = electronAPI.onPluginFeedItem((item: unknown) => {
      store.handlePluginFeedItem(item)
    })
  }
  if (electronAPI?.onPluginFeedUnreadCount) {
    cleanupPluginFeedUnreadCount = electronAPI.onPluginFeedUnreadCount((count: unknown) => {
      store.setPluginFeedUnreadCount(count)
    })
  }
  if (electronAPI?.onPluginSkinsChanged) {
    cleanupPluginSkinsChanged = electronAPI.onPluginSkinsChanged((removedPetIds: unknown) => {
      void store.handlePluginSkinsChanged(removedPetIds)
    })
  }
  if (electronAPI?.getPluginFeedUnreadCount) {
    void electronAPI.getPluginFeedUnreadCount()
      .then((count: unknown) => store.setPluginFeedUnreadCount(count))
      .catch(() => {})
  }
  if (isPanelWindow && electronAPI?.onPanelOpened) {
    cleanupPanelOpened = electronAPI.onPanelOpened((options: { restore: boolean }) => {
      store.handlePanelOpened(options)
    })
  }
  if (isPanelWindow && electronAPI?.onPanelOpenSettings) {
    cleanupPanelOpenSettings = electronAPI.onPanelOpenSettings(() => {
      store.openSettings()
    })
  }
  if (electronAPI?.onDesktopPreferencesUpdated) {
    cleanupDesktopPreferences = electronAPI.onDesktopPreferencesUpdated((preferences: DesktopPreferences) => {
      store.applyDesktopPreferences(preferences)
    })
  }
  if (electronAPI?.onPetWindowModeUpdated) {
    cleanupPetWindowMode = electronAPI.onPetWindowModeUpdated((state: unknown) => {
      store.setPetWindowModeState(state)
    })
  }
  if (electronAPI?.onProgressionUpdated) {
    cleanupProgression = electronAPI.onProgressionUpdated((snapshot: unknown) => {
      store.setProgressionSnapshot(snapshot)
    })
  }
  if (electronAPI?.onAchievementsUpdated) {
    cleanupAchievements = electronAPI.onAchievementsUpdated((snapshot: AchievementSnapshot) => {
      store.setAchievementsSnapshot(snapshot)
    })
  }
  if (electronAPI?.onAchievementUnlocked) {
    cleanupAchievementUnlock = electronAPI.onAchievementUnlocked((unlock: AchievementUnlock) => {
      store.handleAchievementUnlocked(unlock)
    })
  }
  if (electronAPI?.onPermissionRequestsUpdated) {
    cleanupPermissionRequests = electronAPI.onPermissionRequestsUpdated((requests: unknown) => {
      store.setPermissionRequests(requests)
    })
  }
  void store.initializePermissionRequests()
  void store.initializeDesktopPreferences()
  void store.initializePetWindowMode()
  void store.initializeProgression()
  void store.initializeAchievements()
  if (electronAPI?.onQuotaUsageUpdated) {
    cleanupQuotaUpdated = electronAPI.onQuotaUsageUpdated((usage: unknown) => {
      store.setQuotaUsage(usage)
    })
  }
  if (!isPanelWindow && electronAPI?.setMousePassthrough) {
    window.addEventListener('mousemove', handlePetMouseMove, true)
    startLayoutWatch()
  }

  window.addEventListener('storage', handleStorage)

  document.addEventListener('visibilitychange', onDocumentVisibilityChange)
  syncRecurringTimers()
})

watch(() => store.petScale, (v) => {
  document.documentElement.style.setProperty('--pet-scale', String(v))
})

// The main process keeps the MCP status projection sanitized and authoritative
// for DND/enabled state. Only the pet renderer publishes it; the panel never
// becomes a second source of truth.
watch(
  () => store.getPresentationStatus(),
  (snapshot) => {
    if (!isPanelWindow) window.electronAPI?.publishPresentationStatus(snapshot)
  },
  { deep: true, immediate: true },
)

// The compact meter only needs quota while a Codex/Claude family is active.
// The main-process cache coalesces requests from the pet and panel renderer,
// and every result — polled or manual — is broadcast back to both windows.
watch(() => store.hasQuotaCapableSessions, (active) => {
  if (quotaTimer) {
    clearInterval(quotaTimer)
    quotaTimer = null
  }
  if (!active || isPanelWindow) return
  void store.refreshQuota()
  syncRecurringTimers()
}, { immediate: true })

// A finished session is the moment quota actually moved, so refresh off that
// instead of waiting out the poll interval. Forced, because the whole point
// is to bypass the renderer throttle — the main process' own force cooldown
// still collapses a burst of sessions finishing together into one request.
watch(() => store.quotaStaleSignal, () => {
  if (isPanelWindow || document.hidden || quotaSettleTimer) return
  const sinceLast = Date.now() - lastSettleRefreshAt
  const delay = Math.max(
    store.quotaSettleDelayMs,
    store.quotaSettleMinIntervalMs - sinceLast,
  )
  quotaSettleTimer = setTimeout(() => {
    quotaSettleTimer = null
    if (!store.hasQuotaCapableSessions) return
    lastSettleRefreshAt = Date.now()
    void store.refreshQuota(true)
  }, delay)
})

watch(() => store.scaledW, (w) => {
  document.documentElement.style.setProperty('--pet-w', w + 'px')
})

// Only tick the success->idle timeout while something is actually counting
// down, instead of waking up every second for the app's whole lifetime.
watch(() => store.hasSuccessSessions, (active) => {
  if (!active && successTimer) {
    clearInterval(successTimer)
    successTimer = null
  }
  syncRecurringTimers()
}, { immediate: true })

onUnmounted(() => {
  store.setCueSink(null)
  cleanupListener?.()
  cleanupPanelOpened?.()
  cleanupPanelOpenSettings?.()
  cleanupDesktopPreferences?.()
  cleanupPetWindowMode?.()
  cleanupProgression?.()
  cleanupAchievements?.()
  cleanupAchievementUnlock?.()
  cleanupQuotaUpdated?.()
  cleanupPermissionRequests?.()
  cleanupPresentationIntent?.()
  cleanupPluginFeedItem?.()
  cleanupPluginFeedUnreadCount?.()
  cleanupPluginSkinsChanged?.()
  window.removeEventListener('mousemove', handlePetMouseMove, true)
  stopLayoutWatch()
  window.removeEventListener('storage', handleStorage)
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  stopRecurringTimers()
})
</script>

<template>
  <div class="app-container">
    <template v-if="isPanelWindow">
      <StatusPanel />
      <Transition name="wizard">
        <SetupWizard v-if="store.showWizard" @close="store.closeSetupWizard()" />
      </Transition>
      <Transition name="wizard">
        <ProjectMcpPanel v-if="store.showProjectMcpPanel" @close="store.closeProjectMcpPanel()" />
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
