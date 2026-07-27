<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import type { AgentState } from '../types/agent'
import { useAgentStore } from '../stores/agentStore'

const props = defineProps<{
  state: AgentState
  petId: string
}>()

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
  'offline': 1,
  'idle': 6,
  'thinking': 6,
  'tool-running': 6,
  'waiting-permission': 6,
  'waiting-input': 6,
  'success': 6,
  'error': 8,
}

const frameInterval: Record<string, number> = {
  'offline': 0,
  'idle': 600,
  'thinking': 500,
  'tool-running': 500,
  'waiting-permission': 800,
  'waiting-input': 800,
  'success': 400,
  'error': 350,
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
let animFrame: number | null = null
let currentFrame = 0
let lastFrameTime = 0

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
  const img = new Image()

  if (pet && !pet.builtIn) {
    const fileUrl = await window.electronAPI?.getCustomPetSprite(targetId)
    if (!fileUrl) return
    img.src = fileUrl
  } else {
    img.src = getSrc(targetId)
  }

  img.onload = () => {
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
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame)
    animFrame = null
  }

  const interval = frameInterval[props.state] ?? 400

  if (interval === 0) {
    currentFrame = 0
    draw()
    return
  }

  lastFrameTime = 0

  function loop(time: number) {
    if (lastFrameTime === 0) lastFrameTime = time

    if (time - lastFrameTime >= interval) {
      currentFrame++
      lastFrameTime = time
      draw()
    }

    animFrame = requestAnimationFrame(loop)
  }

  animFrame = requestAnimationFrame(loop)
}

watch(() => props.petId, () => {
  currentFrame = 0
  loadImage()
})

watch(() => store.petsLoaded, () => {
  currentFrame = 0
  loadImage()
})

watch(() => props.state, () => {
  currentFrame = 0
  startAnimation()
})

onMounted(() => {
  loadImage()
  startAnimation()
})

onUnmounted(() => {
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame)
  }
})
</script>

<template>
  <canvas
    ref="canvasRef"
    :width="CELL_W"
    :height="CELL_H"
    :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
    class="pet-canvas"
  />
</template>

<style scoped>
.pet-canvas {
  image-rendering: pixelated;
}
</style>
