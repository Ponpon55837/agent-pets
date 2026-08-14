<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAgentStore } from '../stores/agentStore'
import { STATE_LABELS_SHORT, STATE_COLORS } from '../types/agent'
import PetAnimation from './PetAnimation.vue'
import { t } from '../i18n'

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
  if (identity.includes('session') || identity.includes('five_hour')) return t('fiveHourLimit')
  if (identity.includes('weekly') || identity.includes('seven_day')) return t('weeklyLimit')
  return label
}

function quotaDetailPercent(remainingPercent: number): string {
  return String(remainingPercent >= 10
    ? Math.round(remainingPercent)
    : Math.round(remainingPercent * 10) / 10)
}

function quotaResetLabel(resetsAt?: string): string {
  if (!resetsAt) return t('resetTimeUnavailable')
  const reset = new Date(resetsAt)
  if (!Number.isFinite(reset.getTime())) return t('resetTimeUnavailable')
  // No year: the longest quota window is 7 days out, so it carries no
  // information and is the single widest chunk of the tooltip.
  return t('resetAt', { time: reset.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) })
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
    `${quotaDetailLabel(quota.id, quota.label)}：${t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) })} · ${quotaResetLabel(quota.resetsAt)}`
  )).join('\n')
}

function permissionRiskLabel(risk: string): string {
  if (risk === 'high') return t('permissionRiskHigh')
  if (risk === 'medium') return t('permissionRiskMedium')
  if (risk === 'low') return t('permissionRiskLow')
  return t('permissionRiskUnknown')
}

function decidePermission(decision: 'allow_once' | 'deny'): void {
  const request = store.permissionRequest
  if (!request || request.status !== 'pending') return
  void store.decidePermission(request.requestId, decision)
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
    window.electronAPI?.notifyDragEnd(hasMoved.value)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onEdgeMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return
  e.stopPropagation()
  // The main process restores the saved Normal bounds before starting its
  // cursor poll. Calling the same drag path keeps mouse and keyboard entry
  // points consistent without letting the renderer choose native bounds.
  onMouseDown(e)
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

watch(() => store.presentationReaction, (reaction) => {
  if (!reaction || !store.reactionsActive) return
  if (isMultiPet.value) {
    if (reaction.petId) {
      const index = store.familyLines.findIndex(line => line.petId === reaction.petId)
      if (index >= 0) multiPetRefs.value[index]?.playReaction()
    } else {
      multiPetRefs.value.forEach(anim => anim?.playReaction())
    }
    return
  }
  if (!reaction.petId || reaction.petId === store.activePetId) {
    petAnimRef.value?.playReaction()
  }
}, { deep: true })
</script>

<template>
  <div
    class="desktop-pet"
    :class="[`mode-${store.petWindowMode.mode}`, store.petWindowMode.edge ? `edge-${store.petWindowMode.edge}` : '']"
    :data-pet-mode="store.petWindowMode.mode"
  >
    <div
      ref="clickAreaRef"
      class="pet-click-area"
      :class="{ dragging: store.isDragging }"
      @mousedown="onMouseDown"
      @click="onClick"
      @contextmenu.prevent
    >
      <div
        v-if="store.petWindowMode.mode === 'edge'"
        class="edge-peek-handle"
        role="button"
        tabindex="0"
        :aria-label="t('expandFromEdge')"
        data-pet-hit-target="solid"
        @mousedown.stop="onEdgeMouseDown"
        @click.stop="store.setPetMode('normal')"
        @keydown.enter.prevent="store.setPetMode('normal')"
        @keydown.space.prevent="store.setPetMode('normal')"
      >
        <span class="edge-peek-orb" aria-hidden="true"><span /></span>
        <span class="edge-peek-chevron" aria-hidden="true">
          {{ store.petWindowMode.edge === 'left' ? '›' : store.petWindowMode.edge === 'right' ? '‹' : store.petWindowMode.edge === 'top' ? '⌄' : '⌃' }}
        </span>
        <span class="edge-peek-label">{{ t('open') }}</span>
      </div>

      <template v-else>
      <Transition v-if="store.permissionBubbleActive && store.permissionRequest" name="toast" mode="out-in">
        <section
          :key="`permission-${store.permissionRequest.requestId}`"
          class="permission-request"
          :class="[`risk-${store.permissionRequest.risk}`, { deciding: store.permissionRequest.status === 'deciding' }]"
          role="alertdialog"
          aria-labelledby="permission-request-title"
          aria-describedby="permission-request-description"
          data-pet-hit-target="solid"
          @mousedown.stop
          @click.stop
        >
          <header class="permission-request-header">
            <span class="permission-request-icon" aria-hidden="true">!</span>
            <span class="permission-request-heading">
              <strong id="permission-request-title">{{ store.permissionRequest.action }}</strong>
              <span>{{ permissionRiskLabel(store.permissionRequest.risk) }}</span>
            </span>
            <span class="permission-request-queue">
              {{ store.permissionRequest.queuePosition }}/{{ store.permissionRequest.queueSize }}
            </span>
          </header>
          <p id="permission-request-description" class="permission-request-description">
            {{ store.permissionRequest.description }}
          </p>
          <p v-if="store.permissionRequest.truncated" class="permission-request-warning">
            {{ t('permissionWarning') }}
          </p>
          <div class="permission-request-actions">
            <button
              type="button"
              class="permission-button deny"
              :disabled="store.permissionRequest.status !== 'pending'"
              @mousedown.stop
              @click.stop="decidePermission('deny')"
            >
              Deny
              <kbd v-if="store.permissionRequest.hotkeyEligible">Ctrl Shift N</kbd>
            </button>
            <button
              type="button"
              class="permission-button allow"
              :disabled="store.permissionRequest.status !== 'pending'"
              @mousedown.stop
              @click.stop="decidePermission('allow_once')"
            >
              {{ store.permissionRequest.status === 'deciding' ? t('sending') : 'Allow once' }}
              <kbd v-if="store.permissionRequest.hotkeyEligible">Ctrl Shift Y</kbd>
            </button>
          </div>
        </section>
      </Transition>

      <Transition v-else-if="store.permissionBubbleActive && store.permissionNotice" name="toast" mode="out-in">
        <div
          key="permission"
          class="pet-toast permission-notice"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <span class="permission-notice-icon" aria-hidden="true">!</span>
          <span class="permission-notice-copy">
            <strong>{{ store.permissionNotice.title }}</strong>
            <span>{{ store.permissionNotice.detail }}</span>
          </span>
        </div>
      </Transition>

      <Transition v-else-if="store.presentationSay" name="toast" mode="out-in">
        <div
          key="presentation-say"
          class="pet-toast presentation-say"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <span class="presentation-say-icon" aria-hidden="true">✦</span>
          <span>{{ store.presentationSay.message }}</span>
        </div>
      </Transition>

      <Transition v-else-if="!store.permissionRequest && !store.permissionNotice && store.bubbleActive" name="toast" mode="out-in">
        <div
          v-if="store.toast"
          :key="`toast-${store.toast.id}`"
          class="pet-toast timed-toast"
          :class="store.toast.tone"
          role="status"
          aria-live="polite"
          data-pet-hit-target="solid"
        >
          <span class="timed-toast-copy">{{ store.toast.text }}</span>
          <span
            class="toast-countdown-track"
            aria-hidden="true"
          >
            <span
              class="toast-countdown-fill"
              :style="{ '--toast-duration': `${store.toast.countdown.durationMs}ms` }"
            />
          </span>
          <span class="sr-only">{{ t('permissionCountdown') }}</span>
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
              :mood="store.moodVisualsEnabled ? store.mood : undefined"
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
                    <strong class="quota-tooltip-percent">{{ t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) }) }}</strong>
                  </span>
                  <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
                </span>
              </span>
              <span
                v-if="store.quotaByFamily[line.key]"
                class="quota-meter"
                role="progressbar"
                :aria-label="t('quotaRemainingAria', { provider: line.label, quota: store.quotaByFamily[line.key].label })"
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
          :mood="store.moodVisualsEnabled ? store.mood : undefined"
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
                  <strong class="quota-tooltip-percent">{{ t('percentRemaining', { value: quotaDetailPercent(quota.remainingPercent) }) }}</strong>
                </span>
                <span class="quota-tooltip-reset">{{ quotaResetLabel(quota.resetsAt) }}</span>
              </span>
            </span>
            <span
              v-if="store.quotaByFamily[line.key]"
              class="quota-meter"
              role="progressbar"
              :aria-label="t('quotaRemainingAria', { provider: line.label, quota: store.quotaByFamily[line.key].label })"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="store.quotaByFamily[line.key].remainingPercent"
            >
              <span class="quota-meter-fill" :style="quotaFillStyle(line.key)" />
            </span>
          </div>
        </TransitionGroup>
      </template>
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

.desktop-pet.mode-mini .status-lines,
.desktop-pet.mode-mini .multi-pet-row {
  display: none;
}

.desktop-pet.mode-mini .pet-click-area {
  transform: translateX(-50%) scale(0.42);
  transform-origin: 50% 100%;
}

.desktop-pet.mode-mini .pet-click-area.dragging {
  transform: translateX(-50%) translateY(-3px) scale(0.46);
}

.desktop-pet.mode-edge .pet-click-area {
  inset: 0;
  bottom: auto;
  left: 0;
  width: 100%;
  height: 100%;
  transform: none;
  display: block;
  cursor: pointer;
}

.edge-peek-handle {
  pointer-events: auto;
  position: absolute;
  inset: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px;
  border: 1px solid rgba(157, 216, 255, 0.58);
  border-radius: 12px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.2), transparent 58%),
    rgba(24, 28, 42, 0.94);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 0 0 1px rgba(157, 216, 255, 0.08);
  backdrop-filter: blur(12px) saturate(155%);
  -webkit-backdrop-filter: blur(12px) saturate(155%);
  color: #e2f3ff;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
  user-select: none;
}

.edge-peek-handle:hover {
  border-color: #b9e5ff;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.26), transparent 58%),
    rgba(31, 47, 67, 0.97);
  transform: scale(1.03);
}

.edge-peek-handle:active {
  transform: scale(0.97);
}

.edge-peek-handle:focus-visible {
  outline: 2px solid #9dd8ff;
  outline-offset: 2px;
}

.edge-peek-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border: 1px solid rgba(219, 243, 255, 0.88);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f4fcff 0 12%, #9dd8ff 34%, #547ab1 100%);
  box-shadow: 0 0 10px rgba(157, 216, 255, 0.55);
}

.edge-peek-orb span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #19253a;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.32);
}

.edge-peek-chevron {
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 0 9px rgba(157, 216, 255, 0.6);
}

.edge-peek-label {
  font-size: var(--font-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.92;
}

.desktop-pet.mode-edge.edge-left .edge-peek-handle,
.desktop-pet.mode-edge.edge-right .edge-peek-handle {
  writing-mode: vertical-rl;
}

.desktop-pet.mode-edge.edge-top .edge-peek-handle,
.desktop-pet.mode-edge.edge-bottom .edge-peek-handle {
  writing-mode: horizontal-tb;
}

.desktop-pet.mode-edge.edge-left .edge-peek-chevron {
  order: -1;
}

.desktop-pet.mode-edge.edge-right .edge-peek-chevron {
  order: 1;
}

@media (prefers-reduced-transparency: reduce) {
  .edge-peek-handle {
    background: #1c2638;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-contrast: more) {
  .edge-peek-handle {
    border-width: 2px;
    border-color: #b9e5ff;
    background: #111923;
  }
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
  font-size: var(--font-sm);
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
  font-size: var(--font-xs);
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
  font-size: var(--font-sm);
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
.permission-request {
  position: absolute;
  top: 2px;
  left: 50%;
  z-index: 8;
  width: min(248px, calc(var(--pet-w, 260px) - 8px));
  padding: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 216, 112, 0.48);
  border-radius: 16px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.16), transparent 48%),
    linear-gradient(180deg, rgba(43, 42, 54, 0.91), rgba(24, 24, 32, 0.95));
  backdrop-filter: blur(18px) saturate(155%);
  -webkit-backdrop-filter: blur(18px) saturate(155%);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25);
  color: #f8f7fb;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  text-align: left;
  transform: translateX(-50%);
}

.permission-request.risk-high {
  border-color: rgba(255, 128, 118, 0.62);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.42),
    0 0 18px rgba(255, 92, 82, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.permission-request-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.permission-request-icon {
  display: grid;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid rgba(255, 234, 174, 0.38);
  border-radius: 50%;
  background: rgba(231, 190, 73, 0.2);
  color: #ffe6a0;
  font-size: var(--font-md);
  font-weight: 800;
}

.risk-high .permission-request-icon {
  border-color: rgba(255, 173, 165, 0.42);
  background: rgba(255, 91, 82, 0.2);
  color: #ffc0ba;
}

.permission-request-heading {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.permission-request-heading strong {
  overflow: hidden;
  font-size: var(--font-sm);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-request-heading span,
.permission-request-queue {
  color: rgba(239, 237, 246, 0.68);
  font-size: var(--font-xs);
  font-weight: 600;
}

.permission-request-queue {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.permission-request-description {
  display: -webkit-box;
  margin: 8px 1px;
  overflow: hidden;
  color: rgba(247, 245, 251, 0.88);
  font-size: var(--font-xs);
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.permission-request-warning {
  margin: -2px 1px 7px;
  color: #ffd2a3;
  font-size: var(--font-xs);
  line-height: 1.3;
}

.permission-request-actions {
  display: grid;
  grid-template-columns: 0.82fr 1.18fr;
  gap: 7px;
}

.permission-button {
  display: flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #f8f7fb;
  cursor: pointer;
  font: 700 9.5px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.permission-button.allow {
  border-color: rgba(102, 218, 164, 0.4);
  background: rgba(67, 178, 126, 0.18);
  color: #c8f7de;
}

.permission-button.deny {
  color: rgba(248, 247, 251, 0.84);
}

.permission-button:hover:not(:disabled),
.permission-button:focus-visible {
  border-color: rgba(255, 255, 255, 0.42);
  background-color: rgba(255, 255, 255, 0.16);
  outline: none;
  transform: translateY(-1px);
}

.permission-button:focus-visible {
  box-shadow: 0 0 0 2px #14141b, 0 0 0 4px #9dd8ff;
}

.permission-button:disabled {
  cursor: wait;
  opacity: 0.56;
}

.permission-button kbd {
  color: rgba(239, 237, 246, 0.62);
  font: 600 7px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  white-space: nowrap;
}

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

.pet-toast.permission-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(240px, calc(var(--pet-w, 250px) - 10px));
  background:
    linear-gradient(155deg, rgba(255, 255, 255, 0.12), transparent 52%),
    rgba(29, 27, 36, 0.94);
  border-color: rgba(232, 198, 91, 0.58);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.16);
  color: #fff4c4;
  text-align: left;
  white-space: normal;
}

.pet-toast.presentation-say {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  width: max-content;
  max-width: min(260px, calc(var(--pet-w, 250px) - 10px));
  background:
    linear-gradient(155deg, rgba(255, 255, 255, 0.1), transparent 54%),
    rgba(30, 31, 43, 0.94);
  border-color: rgba(157, 176, 255, 0.56);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  color: #e1e6ff;
  font-weight: 500;
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: anywhere;
}

.presentation-say-icon {
  flex: 0 0 auto;
  color: #aab8ff;
  font-size: var(--font-md);
  line-height: 1.25;
}

.permission-notice-icon {
  display: grid;
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  background: rgba(232, 198, 91, 0.2);
  border: 1px solid rgba(255, 235, 164, 0.4);
  font-size: var(--font-md);
  font-weight: 800;
}

.permission-notice-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.permission-notice-copy strong {
  font-size: var(--font-xs);
  line-height: 1.2;
}

.permission-notice-copy span {
  color: rgba(255, 248, 220, 0.82);
  font-size: var(--font-xs);
  font-weight: 500;
  line-height: 1.3;
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

.pet-toast.timed-toast {
  display: flex;
  min-width: 118px;
  flex-direction: column;
  gap: 5px;
  padding-bottom: max(6px, calc(7px * var(--pet-scale, 1)));
}

.timed-toast-copy {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.toast-countdown-track {
  display: block;
  width: 100%;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.toast-countdown-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: currentColor;
  opacity: 0.78;
  transform-origin: left center;
  animation: toast-countdown var(--toast-duration, 3000ms) linear forwards;
}

@keyframes toast-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
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

@media (prefers-reduced-motion: reduce) {
  .permission-button {
    transition: none;
  }

  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }

  .toast-countdown-fill {
    animation-timing-function: steps(6, end);
  }
}

@media (prefers-contrast: more) {
  .permission-request {
    border-width: 2px;
    border-color: #ffe37c;
    background: #17171d;
  }

  .permission-button {
    border-color: currentColor;
  }

  .toast-countdown-track {
    background: rgba(255, 255, 255, 0.38);
    outline: 1px solid currentColor;
    outline-offset: 1px;
  }

  .toast-countdown-fill {
    opacity: 1;
  }

  .pet-toast.permission-notice {
    background: #17171d;
    border-color: #ffe37c;
    color: #fff;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .permission-request {
    background: #1d1b24;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .pet-toast.timed-toast {
    background: #1d1b24;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .pet-toast.permission-notice {
    background: #1d1b24;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .pet-toast.presentation-say {
    background: #1e1f2b;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
