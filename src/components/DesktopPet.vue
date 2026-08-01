<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAgentStore } from '../stores/agentStore'
import { STATE_LABELS_SHORT, STATE_COLORS } from '../types/agent'
import PetAnimation from './PetAnimation.vue'

const store = useAgentStore()
const dragOffset = ref({ x: 0, y: 0 })
const hasMoved = ref(false)
let mouseDownTime = 0
const petAnimRef = ref<InstanceType<typeof PetAnimation> | null>(null)
const multiPetRefs = ref<InstanceType<typeof PetAnimation>[]>([])

// Up to one line per active tool family; when nothing is active, fall back
// to a single line showing the pet's overall (idle/offline) state.
const displayLines = computed(() => {
  if (store.familyLines.length > 0) return store.familyLines
  return [{ key: 'overall', label: '', variants: [], state: store.currentState, project: undefined, count: 0, since: undefined }]
})

// With only one active family, one pet reflects it (and the status lines
// below carry the detail). With more than one — and the opt-in Settings
// toggle on — showing a single pet forces picking a "winner", so instead
// show one small pet per family, side by side.
const isMultiPet = computed(() => store.isMultiPet)

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
    if (hasMoved.value) {
      window.electronAPI?.notifyDragEnd()
    }
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onClick(e: MouseEvent) {
  if (e.button !== 0) return
  if (hasMoved.value) return
  if (isMultiPet.value) {
    multiPetRefs.value.forEach((anim) => anim?.playReaction())
  } else {
    petAnimRef.value?.playReaction()
  }
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
      <Transition v-if="store.bubbleEnabled" name="toast" mode="out-in">
        <div v-if="store.toast" key="toast" class="pet-toast" :class="store.toast.tone">
          {{ store.toast.text }}
        </div>
        <div v-else-if="!isMultiPet && store.activityText" key="activity" class="pet-toast activity">
          🔧 {{ store.activityText }}
        </div>
      </Transition>

      <template v-if="isMultiPet">
        <div class="multi-pet-row">
          <div v-for="line in store.familyLines" :key="line.key" class="multi-pet-item">
            <PetAnimation
              ref="multiPetRefs"
              :state="line.state"
              :pet-id="store.selectedPet"
              :since="line.since"
              :mood="store.mood"
            />
            <span class="multi-pet-label" :style="{ color: STATE_COLORS[line.state] }">
              {{ line.label }}<span v-if="line.variants.length" class="line-variants">&nbsp;({{ line.variants.join('+') }})</span>
            </span>
          </div>
        </div>
      </template>

      <template v-else>
        <PetAnimation
          ref="petAnimRef"
          :state="store.currentState"
          :pet-id="store.selectedPet"
          :since="store.highestPrioritySession?.lastSeenAt"
          :mood="store.mood"
        />
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
      </template>
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

.multi-pet-row {
  pointer-events: auto;
  display: flex;
  align-items: flex-end;
  gap: max(8px, calc(8px * var(--pet-scale, 1)));
}

.multi-pet-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: max(2px, calc(2px * var(--pet-scale, 1)));
}

.multi-pet-label {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: max(9px, calc(9.5px * var(--pet-scale, 1)));
  font-weight: 600;
  max-width: max(70px, calc(80px * var(--pet-scale, 1)));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
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

/* Overlays the top of the canvas rather than sitting in flex flow above it —
   there's no spare window height reserved for it, and deliberately so: on
   show/hide it must never trigger a pet-window resize (that was previously
   causing a slow position drift, since every resize re-anchors the window). */
.pet-toast {
  position: absolute;
  top: max(2px, calc(2px * var(--pet-scale, 1)));
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  max-width: calc(var(--pet-w, 250px) - 10px);
  background: rgba(30, 30, 40, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  color: #f2f2f2;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: max(10px, calc(11px * var(--pet-scale, 1)));
  font-weight: 600;
  line-height: 1.3;
  padding: max(5px, calc(6px * var(--pet-scale, 1))) max(10px, calc(11px * var(--pet-scale, 1)));
  border-radius: max(10px, calc(12px * var(--pet-scale, 1)));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pet-toast::after {
  content: '';
  position: absolute;
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 9px;
  height: 9px;
  background: inherit;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.pet-toast.success {
  border-color: rgba(80, 200, 120, 0.4);
  color: #a6f0c0;
}

.pet-toast.error {
  border-color: rgba(255, 107, 107, 0.4);
  color: #ffb3b3;
}

.pet-toast.activity {
  border-color: rgba(139, 156, 247, 0.35);
  color: #cdd4ff;
  font-weight: 500;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(0.9) translateY(6px);
}
</style>
