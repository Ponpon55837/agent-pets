<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
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
  return [{ key: 'overall', label: '', variants: [], state: store.currentState, project: undefined, count: 0, since: undefined, petId: store.activePetId }]
})

// With only one active family, one pet reflects it (and the status lines
// below carry the detail). With more than one — and the opt-in Settings
// toggle on — showing a single pet forces picking a "winner", so instead
// show one small pet per family, side by side.
const isMultiPet = computed(() => store.isMultiPet)

function quotaColor(familyKey: string): string {
  const quota = store.quotaByFamily[familyKey]
  if (!quota) return 'transparent'
  return quota.remainingPercent < 20
    ? '#ff6b6b'
    : quota.remainingPercent < 50
      ? '#e3b64f'
      : familyKey === 'claude' ? '#d97757' : '#65c89b'
}

function quotaLineStyle(familyKey: string): Record<string, string> {
  return { '--quota-color': quotaColor(familyKey) }
}

function quotaFillStyle(familyKey: string): Record<string, string> {
  const quota = store.quotaByFamily[familyKey]
  if (!quota) return {}
  return {
    width: `${quota.remainingPercent}%`,
  }
}

function quotaPercent(familyKey: string): string {
  const remaining = store.quotaByFamily[familyKey]?.remainingPercent
  if (remaining === undefined) return ''
  return String(remaining >= 10 ? Math.round(remaining) : Math.round(remaining * 10) / 10)
}

function quotaDetails(familyKey: string) {
  const provider = store.quotaUsage?.providers.find((candidate) => candidate.id === familyKey)
  if (!provider) return []
  const primaryWindows = provider.windows.filter((window) => {
    const identity = `${window.id} ${window.label}`.toLowerCase()
    return identity.includes('session')
      || identity.includes('weekly')
      || identity.includes('five_hour')
      || identity.includes('seven_day')
  })
  return (primaryWindows.length > 0 ? primaryWindows : provider.windows).slice(0, 4)
}

function quotaDetailLabel(id: string, label: string): string {
  const identity = `${id} ${label}`.toLowerCase()
  if (identity.includes('session') || identity.includes('five_hour')) return '5-hour limit'
  if (identity.includes('weekly') || identity.includes('seven_day')) return 'Weekly limit'
  return label
}

function quotaDetailPercent(remainingPercent: number): string {
  return String(remainingPercent >= 10
    ? Math.round(remainingPercent)
    : Math.round(remainingPercent * 10) / 10)
}

function quotaResetLabel(resetsAt?: string): string {
  if (!resetsAt) return 'Reset time unavailable'
  const reset = new Date(resetsAt)
  if (!Number.isFinite(reset.getTime())) return 'Reset time unavailable'
  // No year: the longest quota window is 7 days out, so it carries no
  // information and is the single widest chunk of the tooltip.
  return `Resets ${reset.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

// A quota drop is the pet "taking damage" — flash the meter for a moment so
// a change that happened while you weren't looking still registers. Driven
// by a class toggle (not a CSS transition) so consecutive drops re-run the
// animation from the start instead of being swallowed mid-flight.
const draining = ref<Record<string, boolean>>({})
const drainTimers: Record<string, number> = {}
const lastRemaining: Record<string, number> = {}

function flashDrain(familyKey: string) {
  window.clearTimeout(drainTimers[familyKey])
  draining.value = { ...draining.value, [familyKey]: false }
  requestAnimationFrame(() => {
    draining.value = { ...draining.value, [familyKey]: true }
    drainTimers[familyKey] = window.setTimeout(() => {
      draining.value = { ...draining.value, [familyKey]: false }
    }, 700)
  })
}

watch(() => store.quotaByFamily, (quotas) => {
  for (const [familyKey, quota] of Object.entries(quotas)) {
    const previous = lastRemaining[familyKey]
    lastRemaining[familyKey] = quota.remainingPercent
    // Only a meaningful drop counts: refreshes that report the same number
    // (or a reset that refills the bar) shouldn't strobe the meter.
    if (previous !== undefined && quota.remainingPercent < previous - 0.05) {
      flashDrain(familyKey)
    }
  }
}, { deep: true })

onBeforeUnmount(() => {
  Object.values(drainTimers).forEach((timer) => window.clearTimeout(timer))
})

function quotaTitle(familyKey: string): string | undefined {
  const details = quotaDetails(familyKey)
  if (details.length === 0) return undefined
  return details.map((quota) => (
    `${quotaDetailLabel(quota.id, quota.label)}: ${quotaDetailPercent(quota.remainingPercent)}% remaining · ${quotaResetLabel(quota.resetsAt)}`
  )).join('\n')
}

// The sprite is bottom-anchored inside a window that reserves fixed
// transparent headroom above it for the quota tooltip, so how much of the
// window is actually painted varies with pet size and status-line count.
// Main can't derive that, and it's what the status panel anchors to, so
// measure it here and report every change.
const clickAreaRef = ref<HTMLElement | null>(null)
let contentObserver: ResizeObserver | null = null

onMounted(() => {
  store.loadPets()

  if (!clickAreaRef.value || !window.electronAPI?.reportContentHeight) return
  contentObserver = new ResizeObserver(([entry]) => {
    window.electronAPI?.reportContentHeight(Math.ceil(entry.contentRect.height))
  })
  contentObserver.observe(clickAreaRef.value)
})

onBeforeUnmount(() => {
  contentObserver?.disconnect()
  contentObserver = null
})

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  hasMoved.value = false
  mouseDownTime = Date.now()
  store.isDragging = true
  dragOffset.value = { x: e.screenX, y: e.screenY }

  // Actual window movement is driven entirely by the main process polling
  // screen.getCursorScreenPoint() (see electron/main.ts's 'pet-drag-start'
  // handler) rather than by accumulating deltas between renderer mousemove
  // events. On Windows, moving a frameless window under the cursor makes
  // the OS resend a synthetic mousemove for the new window position; a
  // delta-from-previous-event approach picks that up as extra "movement"
  // and re-moves the window again, which re-triggers another synthetic
  // event — a feedback loop that reads as the pet continuously drifting
  // down for as long as the button is held, even with the mouse stationary.
  // Polling the OS cursor position directly sidesteps that loop entirely.
  window.electronAPI?.startDrag()

  const onMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.screenX - dragOffset.value.x
    const dy = moveEvent.screenY - dragOffset.value.y

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      hasMoved.value = true
    }
  }

  const onUp = () => {
    store.isDragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    // Must fire unconditionally, even on a plain click with no movement:
    // 'pet-drag-start' unconditionally started a cursor-poll loop in the
    // main process (see electron/main.ts), and this is the only signal
    // that tells it to stop. Gating it on hasMoved (as the old "did we
    // actually move, so is there anything worth writing to disk" check
    // did) left that poll loop running after a plain click, so the pet
    // kept chasing the cursor around indefinitely after the button was
    // released, right up until the next mousedown replaced it.
    window.electronAPI?.notifyDragEnd()
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
      ref="clickAreaRef"
      class="pet-click-area"
      :class="{ dragging: store.isDragging }"
      @mousedown="onMouseDown"
      @click="onClick"
      @contextmenu.prevent
    >
      <Transition v-if="store.bubbleActive" name="toast" mode="out-in">
        <div v-if="store.toast" key="toast" class="pet-toast" :class="store.toast.tone" data-pet-hit-target="solid">
          {{ store.toast.text }}
        </div>
        <div v-else-if="!isMultiPet && store.activityText" key="activity" class="pet-toast activity" data-pet-hit-target="solid">
          🔧 {{ store.activityText }}
        </div>
      </Transition>

      <template v-if="isMultiPet">
        <div class="multi-pet-row">
          <div v-for="line in store.familyLines" :key="line.key" class="multi-pet-item">
            <PetAnimation
              ref="multiPetRefs"
              :state="line.state"
              :pet-id="line.petId"
              :since="line.since"
              :mood="store.mood"
            />
            <div
              class="status-line multi-pet-status-line"
              :class="{
                'has-quota': store.quotaByFamily[line.key],
                'quota-motion': store.reactionsActive,
                'quota-critical': store.reactionsActive && (store.quotaByFamily[line.key]?.remainingPercent ?? 100) < 10,
                'quota-drain': store.reactionsActive && draining[line.key],
              }"
              :style="quotaLineStyle(line.key)"
              :aria-label="quotaTitle(line.key)"
              :tabindex="store.quotaByFamily[line.key] ? 0 : undefined"
              data-pet-hit-target="solid"
            >
              <span class="line-dot" :style="{ background: STATE_COLORS[line.state], color: STATE_COLORS[line.state] }" />
              <span class="line-text">
                <span class="line-label">{{ line.label }}<span v-if="line.variants.length" class="line-variants">&nbsp;({{ line.variants.join('+') }})</span></span>
                <span class="line-sep">·</span>{{ STATE_LABELS_SHORT[line.state] }}
              </span>
              <span v-if="store.quotaByFamily[line.key]" class="quota-readout">
                {{ quotaPercent(line.key) }}%
              </span>
              <span v-if="store.quotaByFamily[line.key]" class="quota-tooltip" role="tooltip">
                <span
                  v-for="quota in quotaDetails(line.key)"
                  :key="quota.id"
                  class="quota-tooltip-row"
                >
                  <span class="quota-tooltip-summary">
                    <strong>{{ quotaDetailLabel(quota.id, quota.label) }}</strong>
                    <strong class="quota-tooltip-percent">{{ quotaDetailPercent(quota.remainingPercent) }}% remaining</strong>
                  </span>
                  <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
                </span>
              </span>
              <span
                v-if="store.quotaByFamily[line.key]"
                class="quota-meter"
                role="progressbar"
                :aria-label="`${line.label} ${store.quotaByFamily[line.key].label} quota remaining`"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
              >
                <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
              </span>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <PetAnimation
          ref="petAnimRef"
          :state="store.currentState"
          :pet-id="store.activePetId"
          :since="store.highestPrioritySession?.lastSeenAt"
          :mood="store.mood"
        />
        <TransitionGroup tag="div" name="status-line" class="status-lines">
          <div
            v-for="line in displayLines"
            :key="line.key"
            class="status-line"
            :class="{
              'has-quota': store.quotaByFamily[line.key],
              'quota-motion': store.reactionsActive,
              'quota-critical': store.reactionsActive && (store.quotaByFamily[line.key]?.remainingPercent ?? 100) < 10,
              'quota-drain': store.reactionsActive && draining[line.key],
            }"
            :style="quotaLineStyle(line.key)"
            :aria-label="quotaTitle(line.key)"
            :tabindex="store.quotaByFamily[line.key] ? 0 : undefined"
            data-pet-hit-target="solid"
          >
            <span class="line-dot" :style="{ background: STATE_COLORS[line.state], color: STATE_COLORS[line.state] }" />
            <span class="line-text">
              <template v-if="line.label">
                <span class="line-label">{{ line.label }}<span v-if="line.variants.length" class="line-variants">&nbsp;({{ line.variants.join('+') }})</span></span>
                <span class="line-sep">·</span>
              </template>{{ STATE_LABELS_SHORT[line.state] }}
            </span>
            <span v-if="store.quotaByFamily[line.key]" class="quota-readout">
              {{ quotaPercent(line.key) }}%
            </span>
            <span v-if="store.quotaByFamily[line.key]" class="quota-tooltip" role="tooltip">
              <span
                v-for="quota in quotaDetails(line.key)"
                :key="quota.id"
                class="quota-tooltip-row"
              >
                <span class="quota-tooltip-summary">
                  <strong>{{ quotaDetailLabel(quota.id, quota.label) }}</strong>
                  <strong class="quota-tooltip-percent">{{ quotaDetailPercent(quota.remainingPercent) }}% remaining</strong>
                </span>
                <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
              </span>
            </span>
            <span
              v-if="store.quotaByFamily[line.key]"
              class="quota-meter"
              role="progressbar"
              :aria-label="`${line.label} ${store.quotaByFamily[line.key].label} quota remaining`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
            >
              <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
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

.multi-pet-status-line {
  /* Keep the same status-pill treatment as single-pet mode, but constrain
     each pill to its own sprite column instead of the full pet window. */
  width: calc(192px - 12px);
  max-width: calc(192px - 12px);
  margin-top: -8px;
}

.status-lines {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  margin-top: -8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.status-line {
  /* Always rendered at the "L" pet-scale (1x) regardless of the chosen pet
     size — the status bar's dimensions and text size stay constant so it
     doesn't shrink/grow with the pet sprite. */
  position: relative;
  z-index: 1;
  overflow: visible;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: calc(var(--pet-w, 250px) - 14px);
  /* A solid dark layer under the sheen keeps text legible over any
     wallpaper/video behind the transparent pet window — the glass read
     comes from the blur + highlight line, not from true see-through. */
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0) 55%),
    rgba(20, 20, 28, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  color: #f2f2f2;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  font-size: 10.5px;
  line-height: 1.3;
  padding: 3px 9px;
  border-radius: 11px;
}

.status-line:hover,
.status-line:focus-visible {
  z-index: 20;
  outline: none;
}

.status-line.has-quota {
  border-color: color-mix(in srgb, var(--quota-color) 25%, rgba(255, 255, 255, 0.1));
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -3px 7px color-mix(in srgb, var(--quota-color) 9%, transparent);
}

.quota-readout {
  flex-shrink: 0;
  min-width: 25px;
  color: color-mix(in srgb, var(--quota-color) 82%, white);
  font-size: 8.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: right;
  text-shadow: 0 0 6px color-mix(in srgb, var(--quota-color) 55%, transparent);
  /* Scaling from the right keeps the number visually anchored to the pill's
     edge while the critical-state heartbeat runs. */
  transform-origin: 100% 50%;
}

.quota-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  z-index: 30;
  /* Shrink-to-fit: max-content sizes the box to the widest single-line row
     (both rows are nowrap), so there is no dead space to the right of the
     text. The max-width is only a runaway guard for unusually long window
     labels — hitting it is what would let the label wrap, so it must stay
     comfortably above the normal "5-hour limit / NN% remaining" width.
     See QUOTA_TOOLTIP_MIN_W in agentStore.ts, which keeps the pet window
     itself wide enough that this never gets clipped at the window edge. */
  width: max-content;
  max-width: 244px;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--quota-color) 34%, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  /* Solid dark base under the sheen, same rationale as .status-line — the
     tooltip floats over an unpredictable backdrop, so legibility takes
     priority over true see-through transparency. */
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0) 50%),
    rgba(17, 18, 25, 0.94);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  box-shadow:
    0 5px 16px rgba(0, 0, 0, 0.38),
    0 0 9px color-mix(in srgb, var(--quota-color) 13%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.16);
  color: #f3f4f7;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate(-50%, 3px) scale(0.97);
  transform-origin: 50% 100%;
  transition: opacity 0.12s ease, transform 0.12s ease, visibility 0.12s;
}

.quota-tooltip-row {
  display: block;
}

.quota-tooltip-row + .quota-tooltip-row {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.quota-tooltip-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  /* nowrap is what lets max-content size the tooltip to one tidy line per
     row; the label truncates rather than wraps if an unknown window label
     ever runs past the max-width guard. */
  white-space: nowrap;
}

.quota-tooltip-summary > strong:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quota-tooltip-percent {
  color: color-mix(in srgb, var(--quota-color) 82%, white);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.quota-tooltip-reset {
  display: block;
  margin-top: 2px;
  color: rgba(232, 234, 240, 0.8);
  font-size: 0.91em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.quota-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 6px;
  height: 6px;
  border-right: 1px solid color-mix(in srgb, var(--quota-color) 34%, rgba(255, 255, 255, 0.12));
  border-bottom: 1px solid color-mix(in srgb, var(--quota-color) 34%, rgba(255, 255, 255, 0.12));
  background: inherit;
  transform: translate(-50%, -3px) rotate(45deg);
}

.status-line.has-quota:hover .quota-tooltip,
.status-line.has-quota:focus-visible .quota-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0) scale(1);
}

.quota-meter {
  position: absolute;
  right: 1px;
  bottom: 0;
  left: 1px;
  height: 4px;
  overflow: hidden;
  border-radius: 0 0 10px 10px;
  background: rgba(0, 0, 0, 0.38);
  pointer-events: none;
}

/* Full-width white flash layered over the bar, played once per quota drop
   (see the .quota-drain class). Lives on the track rather than the fill so
   it never has to share the fill's `animation` slot with quota-pulse. */
.quota-meter::before {
  content: '';
  position: absolute;
  z-index: 3;
  inset: 0;
  background: rgba(255, 255, 255, 0.92);
  opacity: 0;
}

.quota-drain .quota-meter::before {
  animation: quota-drain-flash 0.7s ease-out;
}

.quota-meter::after {
  content: '';
  position: absolute;
  z-index: 2;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent calc(10% - 1px),
    rgba(7, 10, 12, 0.42) calc(10% - 1px),
    rgba(7, 10, 12, 0.42) 10%
  );
}

.quota-meter-fill {
  position: relative;
  display: block;
  height: 100%;
  border-radius: inherit;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--quota-color) 72%, #15201d),
      var(--quota-color) 72%,
      color-mix(in srgb, var(--quota-color) 72%, white) 100%
    );
  box-shadow:
    0 0 6px var(--quota-color),
    0 -1px 6px color-mix(in srgb, var(--quota-color) 45%, transparent);
  transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.25s ease;
}

/* Sheen that travels along the filled portion. Positioned via
   background-position (not transform) so the highlight stays inside the
   fill's own box — the fill can't clip its children, since the glowing head
   below deliberately overhangs its right edge. */
.quota-meter-fill::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    100deg,
    transparent 38%,
    rgba(255, 255, 255, 0.72) 50%,
    transparent 62%
  );
  background-repeat: no-repeat;
  background-size: 260% 100%;
  background-position: 150% 0;
}

.quota-motion .quota-meter-fill::before {
  animation: quota-sheen 3.4s ease-in-out infinite;
}

.quota-meter-fill::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 7px 2px var(--quota-color);
  opacity: 0.9;
  transform: translate(35%, -50%);
}

.quota-motion:not(.quota-critical) .quota-meter-fill::after {
  animation: quota-spark 2.4s ease-in-out infinite;
}

.quota-critical .quota-meter-fill {
  animation: quota-pulse 1.8s ease-in-out infinite;
}

/* Below 10% the whole readout joins in: the bar throws an alarm glow and
   the percentage beats, so a nearly-empty quota is noticeable from across
   the desk rather than only on a close look. */
.quota-critical .quota-meter {
  animation: quota-alarm 1.8s ease-in-out infinite;
}

.quota-critical .quota-readout {
  animation: quota-heartbeat 1.8s ease-in-out infinite;
}

@keyframes quota-pulse {
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; filter: brightness(1.28); }
}

@keyframes quota-spark {
  0%, 68%, 100% { opacity: 0.55; transform: translate(35%, -50%) scale(0.75); }
  78% { opacity: 1; transform: translate(35%, -50%) scale(1.18); }
}

@keyframes quota-sheen {
  0% { background-position: 150% 0; }
  60%, 100% { background-position: -60% 0; }
}

@keyframes quota-drain-flash {
  0% { opacity: 0.6; }
  100% { opacity: 0; }
}

@keyframes quota-alarm {
  0%, 100% { box-shadow: 0 0 0 color-mix(in srgb, var(--quota-color) 0%, transparent); }
  50% { box-shadow: 0 0 9px color-mix(in srgb, var(--quota-color) 65%, transparent); }
}

@keyframes quota-heartbeat {
  0%, 100% { transform: scale(1); opacity: 0.82; }
  50% { transform: scale(1.14); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .quota-meter-fill {
    transition: none;
    animation: none !important;
  }

  .quota-meter,
  .quota-meter::before,
  .quota-readout,
  .quota-meter-fill::before,
  .quota-meter-fill::after {
    animation: none !important;
  }
}

.line-dot {
  width: 5px;
  height: 5px;
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
  margin: 0 3px;
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
