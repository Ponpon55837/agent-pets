<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAgentStore } from '../stores/agentStore'
import { STATE_LABELS_SHORT, STATE_COLORS } from '../types/agent'
import PetAnimation from './PetAnimation.vue'

const store = useAgentStore()
const dragOffset = ref({ x: 0, y: 0 })
const hasMoved = ref(false)
let mouseDownTime = 0

// Up to one line per active tool family; when nothing is active, fall back
// to a single line showing the pet's overall (idle/offline) state.
const displayLines = computed(() => {
  if (store.familyLines.length > 0) return store.familyLines
  return [{ key: 'overall', label: '', variants: [], state: store.currentState, project: undefined, count: 0 }]
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
  store.togglePanel()
}
</script>

<template>
  <div class="desktop-pet">
    <div
      class="pet-click-area"
      :class="{ dragging: store.isDragging }"
      @mousedown="onMouseDown"
      @click="onClick"
      @contextmenu.prevent
    >
      <PetAnimation :state="store.currentState" :pet-id="store.selectedPet" />
      <TransitionGroup tag="div" name="status-line" class="status-lines">
        <div v-for="line in displayLines" :key="line.key" class="status-line">
          <span class="line-dot" :style="{ background: STATE_COLORS[line.state], color: STATE_COLORS[line.state] }" />
          <span class="line-text">
            <template v-if="line.label">
              <span class="line-label">{{ line.label }}<span v-if="line.variants.length" class="line-variants">&nbsp;({{ line.variants.join('+') }})</span></span>
              <span class="line-sep">·</span>
            </template>{{ STATE_LABELS_SHORT[line.state] }}
          </span>
        </div>
      </TransitionGroup>
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
  transition: transform 0.15s ease, filter 0.15s ease;
}

.pet-click-area:active {
  cursor: grabbing;
}

.pet-click-area.dragging {
  transform: translateX(-50%) translateY(-6px) scale(1.05);
  filter: drop-shadow(0 10px 14px rgba(0, 0, 0, 0.35));
}

.status-lines {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: max(3px, calc(3px * var(--pet-scale, 1)));
  margin-top: max(-8px, calc(-8px * var(--pet-scale, 1)));
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.status-line {
  display: flex;
  align-items: center;
  gap: max(5px, calc(5px * var(--pet-scale, 1)));
  max-width: calc(var(--pet-w, 250px) - 14px);
  background: rgba(24, 24, 32, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  color: #f2f2f2;
  font-size: max(10px, calc(10.5px * var(--pet-scale, 1)));
  line-height: 1.3;
  padding: max(3px, calc(3px * var(--pet-scale, 1))) max(9px, calc(9px * var(--pet-scale, 1)));
  border-radius: max(10px, calc(11px * var(--pet-scale, 1)));
}

.line-dot {
  width: max(5px, calc(5px * var(--pet-scale, 1)));
  height: max(5px, calc(5px * var(--pet-scale, 1)));
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
}

.line-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.line-label {
  font-weight: 600;
}

.line-variants {
  font-weight: 400;
  opacity: 0.75;
}

.line-sep {
  opacity: 0.45;
  margin: 0 max(3px, calc(3px * var(--pet-scale, 1)));
}

.status-line-enter-active,
.status-line-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.status-line-enter-from,
.status-line-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(3px);
}
</style>
