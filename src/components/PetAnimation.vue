<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import type { AgentState } from '../types/agent'
import { useAgentStore } from '../stores/agentStore'

const props = defineProps<{
  state: AgentState
  petId: string
  since?: number
  mood?: number
}>()

// Purely cosmetic bias from the mood meter — a warm glow when things have
// been going well, a slight dim/desaturate when they haven't. No new sprite
// frames needed, same CSS-filter trick as the rest of the reaction layer.
const moodTier = computed<'happy' | 'neutral' | 'low'>(() => {
  if (props.mood === undefined) return 'neutral'
  if (props.mood >= 70) return 'happy'
  if (props.mood <= 25) return 'low'
  return 'neutral'
})

const store = useAgentStore()

const CELL_W = 192
const CELL_H = 208

const stateToRow: Record<string, number> = {
  'offline': 0,
  'idle': 0,
  'thinking': 7,
  'tool-running': 7,
  'waiting-permission': 6,
  'waiting-input': 6,
  'success': 8,
  'error': 5,
}

const stateFrameCount: Record<string, number> = {
  // Offline uses the calm idle loop rather than a frozen first frame. The
  // slow cadence makes it visibly alive without implying active work.
  'offline': 6,
  'idle': 6,
  'thinking': 6,
  'tool-running': 6,
  'waiting-permission': 6,
  'waiting-input': 6,
  'success': 6,
  'error': 8,
}

const frameInterval: Record<string, number> = {
  'offline': 950,
  'idle': 700,
  'thinking': 680,
  'tool-running': 360,
  'waiting-permission': 850,
  'waiting-input': 1050,
  'success': 190,
  'error': 260,
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
const imageCache = new Map<string, HTMLImageElement>()
let animTimer: ReturnType<typeof setTimeout> | null = null
let currentFrame = 0

// One-shot squash/stretch "reaction" bounce, layered on top of the looping
// state animation via a CSS class rather than extra spritesheet frames, so
// it works for every pet regardless of how many rows its sheet has.
const isReacting = ref(false)
let reactionTimer: ReturnType<typeof setTimeout> | null = null
function playReaction() {
  isReacting.value = false
  requestAnimationFrame(() => {
    isReacting.value = true
    if (reactionTimer) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => { isReacting.value = false }, 260)
  })
}
defineExpose({ playReaction })

// Idle fidgets: a periodic subtle sway (no new sprite frames needed, same
// CSS-layer trick as the reaction bounce) so a long idle stretch doesn't
// feel completely static. Only scheduled while state === 'idle'.
const isFidgeting = ref(false)
let fidgetTimer: ReturnType<typeof setTimeout> | null = null
let fidgetResetTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFidget() {
  if (fidgetTimer) clearTimeout(fidgetTimer)
  const delay = 6000 + Math.random() * 9000
  fidgetTimer = setTimeout(() => {
    if (props.state === 'idle') {
      isFidgeting.value = false
      requestAnimationFrame(() => {
        isFidgeting.value = true
        if (fidgetResetTimer) clearTimeout(fidgetResetTimer)
        fidgetResetTimer = setTimeout(() => { isFidgeting.value = false }, 700)
      })
    }
    scheduleFidget()
  }, delay)
}

function stopFidgetTimer() {
  if (fidgetTimer) {
    clearTimeout(fidgetTimer)
    fidgetTimer = null
  }
  isFidgeting.value = false
}

// The longer a waiting-permission/waiting-input session sits unanswered,
// the faster & shakier the pet gets, nudging the user to go respond.
const isWaiting = computed(() => props.state === 'waiting-permission' || props.state === 'waiting-input')
const urgencyTick = ref(Date.now())
let urgencyTimer: ReturnType<typeof setInterval> | null = null

function startUrgencyTimer() {
  if (urgencyTimer) return
  urgencyTick.value = Date.now()
  urgencyTimer = setInterval(() => { urgencyTick.value = Date.now() }, 500)
}

function stopUrgencyTimer() {
  if (urgencyTimer) {
    clearInterval(urgencyTimer)
    urgencyTimer = null
  }
}

const urgencyLevel = computed(() => {
  if (!isWaiting.value || !props.since) return 0
  const elapsedSec = Math.max(0, urgencyTick.value - props.since) / 1000
  if (elapsedSec >= 30) return 2
  if (elapsedSec >= 12) return 1
  return 0
})

function currentInterval(): number {
  const base = frameInterval[props.state] ?? 400
  if (urgencyLevel.value === 2) return Math.max(120, Math.round(base * 0.45))
  if (urgencyLevel.value === 1) return Math.max(180, Math.round(base * 0.7))
  return base
}

const canvasW = computed(() => Math.round(CELL_W * store.petScale))
const canvasH = computed(() => Math.round(CELL_H * store.petScale))

function getSrc(id: string): string {
  const base = import.meta.env.BASE_URL || './'
  return `${base}pets/${id}/spritesheet.webp`
}

async function loadImage() {
  const id = props.petId || 'qitian-dasheng'
  const pet = store.pets.find(p => p.id === id)

  if (!pet && !store.petsLoaded) {
    return
  }

  const targetId = pet ? id : 'qitian-dasheng'

  const cached = imageCache.get(targetId)
  if (cached) {
    imgRef.value = cached
    currentFrame = 0
    draw()
    return
  }

  const img = new Image()

  if (pet && !pet.builtIn) {
    const fileUrl = await window.electronAPI?.getCustomPetSprite(targetId)
    if (!fileUrl) return
    img.src = fileUrl
  } else {
    img.src = getSrc(targetId)
  }

  img.onload = () => {
    imageCache.set(targetId, img)
    imgRef.value = img
    currentFrame = 0
    draw()
  }
}

function draw() {
  const canvas = canvasRef.value
  const img = imgRef.value
  if (!canvas || !img || !img.complete) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const row = stateToRow[props.state] ?? 0
  const maxFrames = stateFrameCount[props.state] ?? 1
  const frame = currentFrame % maxFrames

  ctx.clearRect(0, 0, CELL_W, CELL_H)
  ctx.drawImage(
    img,
    frame * CELL_W, row * CELL_H,
    CELL_W, CELL_H,
    0, 0,
    CELL_W, CELL_H
  )
}

function startAnimation() {
  if (animTimer !== null) {
    clearTimeout(animTimer)
    animTimer = null
  }

  const interval = currentInterval()
  const maxFrames = stateFrameCount[props.state] ?? 1

  if (interval === 0) {
    currentFrame = 0
    draw()
    return
  }

  function tick() {
    currentFrame++
    // Success and error are reactions, not ongoing activities. Play their
    // row once, then hold the final frame until the store reports another
    // state instead of looping the same celebration/failure forever.
    if ((props.state === 'success' || props.state === 'error') && currentFrame >= maxFrames - 1) {
      currentFrame = maxFrames - 1
      draw()
      animTimer = null
      return
    }
    draw()
    animTimer = setTimeout(tick, currentInterval())
  }

  animTimer = setTimeout(tick, interval)
}

watch(() => props.petId, () => {
  currentFrame = 0
  loadImage()
})

watch(() => store.petsLoaded, () => {
  currentFrame = 0
  loadImage()
})

watch(() => props.state, (newState, oldState) => {
  currentFrame = 0
  startAnimation()
  if (oldState !== undefined && newState !== oldState) {
    playReaction()
  }
  if (newState === 'idle') {
    scheduleFidget()
  } else {
    stopFidgetTimer()
  }
  if (newState === 'waiting-permission' || newState === 'waiting-input') {
    startUrgencyTimer()
  } else {
    stopUrgencyTimer()
  }
})

onMounted(() => {
  loadImage()
  startAnimation()
  if (props.state === 'idle') {
    scheduleFidget()
  }
  if (isWaiting.value) {
    startUrgencyTimer()
  }
})

onUnmounted(() => {
  if (animTimer !== null) {
    clearTimeout(animTimer)
  }
  if (reactionTimer !== null) {
    clearTimeout(reactionTimer)
  }
  stopFidgetTimer()
  stopUrgencyTimer()
})
</script>

<template>
  <canvas
    ref="canvasRef"
    :width="CELL_W"
    :height="CELL_H"
    :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
    class="pet-canvas"
    :class="{
      'pet-reacting': store.reactionsEnabled && isReacting,
      'pet-fidgeting': store.reactionsEnabled && isFidgeting && !isReacting && urgencyLevel === 0,
      'pet-urgent-1': store.reactionsEnabled && !isReacting && urgencyLevel === 1,
      'pet-urgent-2': store.reactionsEnabled && !isReacting && urgencyLevel === 2,
      'pet-idle-ambient': store.reactionsEnabled && props.state === 'idle' && !isReacting && !isFidgeting,
      'pet-thinking-ambient': store.reactionsEnabled && props.state === 'thinking' && !isReacting,
      'pet-tool-ambient': store.reactionsEnabled && props.state === 'tool-running' && !isReacting,
      'pet-waiting-input': store.reactionsEnabled && props.state === 'waiting-input' && !isReacting && urgencyLevel === 0,
      'pet-offline-ambient': props.state === 'offline',
      'pet-mood-happy': moodTier === 'happy',
      'pet-mood-low': moodTier === 'low',
    }"
  />
</template>

<style scoped>
.pet-canvas {
  image-rendering: pixelated;
  transform-origin: 50% 100%;
}

.pet-canvas.pet-offline-ambient {
  animation: pet-offline-breathe 3.8s ease-in-out infinite;
}

/* Ambient behavior is deliberately subtle and only enabled with the
   reactions setting. The spritesheet remains responsible for the main pose;
   these small loops keep long-running states from feeling frozen. */
.pet-canvas.pet-idle-ambient {
  animation: pet-breathe 3.8s ease-in-out infinite;
}

.pet-canvas.pet-thinking-ambient {
  animation: pet-think 2.8s ease-in-out infinite;
}

.pet-canvas.pet-tool-ambient {
  animation: pet-tool-pulse 1.15s ease-in-out infinite;
}

.pet-canvas.pet-waiting-input {
  animation: pet-listen 2.4s ease-in-out infinite;
}

@keyframes pet-breathe {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.012, 0.992); }
}

@keyframes pet-offline-breathe {
  0%, 100% { transform: translateY(0) scale(1, 1); opacity: 0.86; }
  50% { transform: translateY(-2px) scale(1.018, 0.988); opacity: 1; }
}

@keyframes pet-think {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@keyframes pet-tool-pulse {
  0%, 100% { transform: translateY(0) scale(1); }
  45% { transform: translateY(-1px) scale(1.008); }
  70% { transform: translateY(0) scale(1); }
}

@keyframes pet-listen {
  0%, 100% { transform: rotate(0deg); }
  35% { transform: rotate(-1.5deg); }
  65% { transform: rotate(1deg); }
}

.pet-canvas.pet-reacting {
  animation: pet-bounce 0.26s ease;
}

@keyframes pet-bounce {
  0% { transform: scale(1, 1); }
  30% { transform: scale(1.16, 0.85); }
  60% { transform: scale(0.92, 1.1); }
  100% { transform: scale(1, 1); }
}

.pet-canvas.pet-fidgeting {
  animation: pet-fidget 0.7s ease;
}

@keyframes pet-fidget {
  0%, 100% { transform: rotate(0deg) translateY(0); }
  20% { transform: rotate(-4deg) translateY(-2px); }
  40% { transform: rotate(3deg) translateY(0); }
  60% { transform: rotate(-2deg) translateY(-1px); }
  80% { transform: rotate(1deg) translateY(0); }
}

.pet-canvas.pet-urgent-1 {
  animation: pet-shake-1 0.6s ease-in-out infinite;
}

.pet-canvas.pet-urgent-2 {
  animation: pet-shake-2 0.35s ease-in-out infinite;
}

@keyframes pet-shake-1 {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  50% { transform: translateX(2px) rotate(1deg); }
}

@keyframes pet-shake-2 {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(-3px) rotate(-2deg); }
  75% { transform: translateX(3px) rotate(2deg); }
}

.pet-canvas.pet-mood-happy {
  filter: drop-shadow(0 0 6px rgba(255, 210, 120, 0.55)) saturate(1.15);
}

.pet-canvas.pet-mood-low {
  filter: grayscale(0.45) brightness(0.88);
}
</style>
