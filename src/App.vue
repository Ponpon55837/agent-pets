<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from './stores/agentStore'
import DesktopPet from './components/DesktopPet.vue'
import StatusPanel from './components/StatusPanel.vue'
import SetupWizard from './components/SetupWizard.vue'

const store = useAgentStore()

let cleanupListener: (() => void) | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let successTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  document.documentElement.style.setProperty('--pet-scale', String(store.petScale))

  const electronAPI = (window as any).electronAPI
  if (electronAPI?.onAgentStatusEvent) {
    cleanupListener = electronAPI.onAgentStatusEvent((event: unknown) => {
      store.handleEvent(event as any)
    })
  }

  staleTimer = setInterval(() => {
    store.cleanupStale()
  }, 60_000)

  successTimer = setInterval(() => {
    store.handleSuccessTimeout()
  }, 1_000)
})

watch(() => store.petScale, (v) => {
  document.documentElement.style.setProperty('--pet-scale', String(v))
})

onUnmounted(() => {
  cleanupListener?.()
  if (staleTimer) clearInterval(staleTimer)
  if (successTimer) clearInterval(successTimer)
})
</script>

<template>
  <div class="app-container">
    <DesktopPet />
    <StatusPanel />
    <Transition name="wizard">
      <SetupWizard v-if="store.showWizard" @close="store.showWizard = false" />
    </Transition>
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
