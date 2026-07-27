<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAgentStore } from '../stores/agentStore'
import { STATE_LABELS, SOURCE_LABELS } from '../types/agent'
import PetAnimation from './PetAnimation.vue'

const store = useAgentStore()
const dragOffset = ref({ x: 0, y: 0 })
const hasMoved = ref(false)
let mouseDownTime = 0

const stateLabel = computed(() => {
  return STATE_LABELS[store.currentState] ?? 'Unknown'
})

const sourceLabel = computed(() => {
  return store.currentSource ? SOURCE_LABELS[store.currentSource] : null
})

const badgeText = computed(() => {
  if (sourceLabel.value) {
    return `${sourceLabel.value} · ${stateLabel.value}`
  }
  return stateLabel.value
})

onMounted(() => {
  store.loadPets()
})

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  hasMoved.value = false
  mouseDownTime = Date.now()
  store.isDragging = true
  dragOffset.value = { x: e.screenX, y: e.screenY }

  const onMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.screenX - dragOffset.value.x
    const dy = moveEvent.screenY - dragOffset.value.y
    dragOffset.value = { x: moveEvent.screenX, y: moveEvent.screenY }

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      hasMoved.value = true
    }

    window.electronAPI?.moveWindow(dx, dy)
  }

  const onUp = () => {
    store.isDragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onClick(e: MouseEvent) {
  if (e.button !== 0) return
  if (hasMoved.value) return
  store.openPanel()
}
</script>

<template>
  <div class="desktop-pet">
    <div
      class="pet-click-area"
      @mousedown="onMouseDown"
      @click="onClick"
      @contextmenu.prevent
    >
      <PetAnimation :state="store.currentState" :pet-id="store.selectedPet" />
      <div class="state-badge">
        {{ badgeText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.desktop-pet {
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.pet-click-area {
  pointer-events: auto;
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(4px * var(--pet-scale, 1));
  cursor: grab;
}

.pet-click-area:active {
  cursor: grabbing;
}

.state-badge {
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: max(11px, calc(11px * var(--pet-scale, 1)));
  padding: max(2px, calc(2px * var(--pet-scale, 1))) max(8px, calc(8px * var(--pet-scale, 1)));
  border-radius: max(10px, calc(10px * var(--pet-scale, 1)));
  white-space: nowrap;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin-top: max(-8px, calc(-8px * var(--pet-scale, 1)));
}
</style>
