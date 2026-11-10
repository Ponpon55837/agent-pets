<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t, tPlural, type TranslationKey } from '@/i18n'
import { alsoAnswerableKey, permissionSourceName } from '@/utils/permission-source'
import type { PermissionOutcomeKind } from '@/types/permission'
import Button from '@/components/ui/Button.vue'
import PermissionRiskBadge from '@/components/permission/PermissionRiskBadge.vue'
import PermissionDetails from '@/components/permission/PermissionDetails.vue'
import PermissionCountdown from '@/components/permission/PermissionCountdown.vue'
import PermissionQueueOverview from '@/components/permission/PermissionQueueOverview.vue'
import { usePermissionClickGuard } from '@/components/permission/usePermissionClickGuard'
import { usePermissionClock } from '@/components/permission/usePermissionClock'
import { usePermissionKeyboard } from '@/components/permission/usePermissionKeyboard'

const store = useAgentStore()
const now = usePermissionClock()
const request = computed(() => store.permissionRequest)
const outcome = computed(() => store.permissionOutcome)

const OUTCOME_KEYS: Record<PermissionOutcomeKind, TranslationKey> = {
  expired: 'permission.outcomeExpired',
  cancelled: 'permission.outcomeCancelled',
  delivery_failed: 'permission.outcomeDeliveryFailed',
  conflict: 'permission.outcomeConflict',
  error: 'permission.outcomeError',
}

function outcomeText(kind: PermissionOutcomeKind, agentId: string): string {
  return t(OUTCOME_KEYS[kind], { source: permissionSourceName(agentId) })
}

// A request that is still pending but whose last decision attempt errored.
const inlineError = computed(() => {
  const current = request.value
  const result = outcome.value
  if (!current || !result || result.requestId !== current.requestId || result.kind !== 'error') return null
  return outcomeText(result.kind, current.agentId)
})

// A new request ignores clicks for a moment (see usePermissionClickGuard); then the safe
// choice (Deny) takes focus, but only if this window already has focus: stealing focus
// from another app's text field would be worse than not focusing at all.
const denyButton = ref<InstanceType<typeof Button> | null>(null)
const { armed, arm } = usePermissionClickGuard(() => {
  if (document.hasFocus()) (denyButton.value?.$el as HTMLButtonElement | undefined)?.focus({ preventScroll: true })
})

function decide(decision: 'allow_once' | 'deny', viaKeyboard = false): void {
  const current = request.value
  if (!current || current.status !== 'pending') return
  if (!current.allowedDecisions.includes(decision)) return
  // Denying is always safe, so the keyboard may deny straight away.
  if (!armed.value && !(viaKeyboard && decision === 'deny')) return
  void store.decidePermission(current.requestId, decision)
}

// --- Queue overview -----------------------------------------------------------
const queueOpen = ref(false)
const hasQueue = computed(() => store.permissionRequests.length > 1)

function toggleQueue(): void {
  queueOpen.value = !queueOpen.value
}

const RISK_LABEL_KEYS: Record<string, TranslationKey> = {
  high: 'permissionRiskHigh',
  medium: 'permissionRiskMedium',
  low: 'permissionRiskLow',
}

const announcement = computed(() => {
  const current = request.value
  if (!current) return ''
  return t('permission.announce', {
    source: permissionSourceName(current.agentId),
    action: current.action,
    risk: t(RISK_LABEL_KEYS[current.risk] ?? 'permissionRiskUnknown'),
  })
})

// Global shortcut labels come from the main process (platform-correct); they
// are only advertised when the shortcut is actually registered.
const hotkey = computed(() => request.value?.hotkey ?? null)
const showHotkeys = computed(() => hotkey.value?.status === 'active')
// Main reports a platform-formatted label ("⌘⇧Y" or "Ctrl+Shift+Y"); render one key cap per key.
function keyCaps(label: string | undefined): string[] {
  if (!label) return []
  return label.includes('+') ? label.split('+').filter(Boolean) : Array.from(label)
}
const denyKeyCaps = computed(() => keyCaps(hotkey.value?.denyLabel))
const allowKeyCaps = computed(() => keyCaps(hotkey.value?.allowLabel))
// 模板裡多處用到，算一次。
const sourceName = computed(() => (request.value ? permissionSourceName(request.value.agentId) : ''))
const hotkeyBlocked = computed(() => hotkey.value?.status === 'unavailable')
const alsoAnswerKey = computed(() => (request.value ? alsoAnswerableKey(request.value.agentId) : null))
// The broker drops allow_once for a risky request whose arguments were cut off.
const canAllow = computed(() => request.value?.allowedDecisions.includes('allow_once') ?? false)

// --- In-window keyboard (only while focus is inside the bubble) --------------
const { needsHold, holdProgress, cancelHold, onKeydown, onKeyup } = usePermissionKeyboard({
  risk: computed(() => request.value?.risk),
  decide,
})

watch(() => request.value?.requestId, (id) => {
  cancelHold()
  queueOpen.value = false
  if (id) arm()
}, { immediate: true })
</script>

<template>
  <section
    v-if="request"
    class="permission-request"
    :class="[`risk-${request.risk}`, { deciding: request.status === 'deciding' }]"
    role="alertdialog"
    aria-labelledby="permission-request-title"
    aria-describedby="permission-request-description"
    data-pet-hit-target="solid"
    @mousedown.stop
    @click.stop
    @keydown="onKeydown"
    @keyup="onKeyup"
    @focusout="cancelHold"
  >
    <span class="permission-sr-only" aria-live="assertive">{{ announcement }}</span>
    <header class="permission-request-header">
      <span class="permission-request-source">{{ sourceName }}</span>
      <span class="permission-request-project" :title="request.projectId">{{ request.projectId || t('projectUnknown') }}</span>
      <Button
        v-if="hasQueue"
        variant="ghost"
        size="sm"
        class="permission-request-queue permission-queue-toggle"
        :aria-expanded="queueOpen"
        :aria-label="tPlural('permission.queueToggle', request.queueSize)"
        @mousedown.stop
        @click.stop="toggleQueue"
      >
        {{ request.queuePosition }}/{{ request.queueSize }}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="queueOpen ? 'M3 10.5 8 5.5l5 5' : 'M3 5.5l5 5 5-5'" />
        </svg>
      </Button>
      <span v-else class="permission-request-queue">{{ request.queuePosition }}/{{ request.queueSize }}</span>
    </header>
    <PermissionQueueOverview v-if="queueOpen && hasQueue" :now="now" />
    <p class="permission-request-heading">
      <strong id="permission-request-title">{{ request.action }}</strong>
      <PermissionRiskBadge :risk="request.risk" :network="request.network" />
    </p>
    <PermissionDetails :request="request" id-prefix="permission-request" />
    <PermissionCountdown :request="request" :now="now" />
    <p v-if="inlineError" class="permission-request-error" role="alert">{{ inlineError }}</p>
    <div class="permission-request-actions">
      <Button
        ref="denyButton"
        class="permission-button deny"
        :disabled="request.status !== 'pending' || !armed"
        @mousedown.stop
        @click.stop="decide('deny')"
      >
        {{ t('permissionDeny') }}
        <span v-if="showHotkeys" class="permission-keycaps"><kbd v-for="key in denyKeyCaps" :key="key">{{ key }}</kbd></span>
      </Button>
      <Button
        class="permission-button allow"
        :disabled="request.status !== 'pending' || !armed || !canAllow"
        @mousedown.stop
        @click.stop="decide('allow_once')"
      >
        {{ request.status === 'deciding' ? t('sending') : t('permissionAllowOnce') }}
        <span v-if="showHotkeys" class="permission-keycaps"><kbd v-for="key in allowKeyCaps" :key="key">{{ key }}</kbd></span>
      </Button>
    </div>
    <p v-if="!canAllow" class="permission-request-hint">{{ t('permission.allowNeedsFullView', { source: sourceName }) }}</p>
    <p v-if="alsoAnswerKey" class="permission-request-hint">{{ t(alsoAnswerKey, { source: sourceName }) }}</p>
    <p v-if="hotkeyBlocked" class="permission-request-hint">{{ t('permission.hotkeyUnavailable') }}</p>
    <p class="permission-request-hint permission-keyboard-hint" :class="{ holding: holdProgress }">
      {{ needsHold ? t('permission.keyboardHint') : t('permission.keyboardHintLow') }}
    </p>
  </section>

  <section
    v-else-if="outcome"
    class="permission-request permission-outcome"
    :class="`outcome-${outcome.kind}`"
    role="status"
    aria-live="polite"
    data-pet-hit-target="solid"
    @mousedown.stop
    @click.stop
  >
    <p class="permission-outcome-text">{{ outcomeText(outcome.kind, outcome.agentId) }}</p>
    <div class="permission-request-actions">
      <Button class="permission-button deny" @mousedown.stop @click.stop="store.dismissPermissionOutcome()">
        {{ t('permission.dismiss') }}
      </Button>
      <Button class="permission-button allow" @mousedown.stop @click.stop="store.togglePanel()">
        {{ t('permission.viewInPanel') }}
      </Button>
    </div>
  </section>
</template>

<style scoped>
/* Sits ABOVE the sprite in the reserved headroom so the pet stays visible and
   showing/hiding never resizes the pet window. 高度不能超過預留空間：超出的部分會被視窗
   裁掉，最先消失的就是來源列與風險徽章。所以上限是預留高度，指令細節區在裡面捲動，
   標題、風險徽章、倒數與按鈕永遠看得到。 */
.permission-request {
  position: absolute;
  display: flex;
  max-height: calc(var(--pet-bubble-headroom) - 4px);
  flex-direction: column;
  bottom: calc(100% - 2px);
  left: 50%;
  transform-origin: 50% 100%;
  z-index: calc(var(--z-base) + 8);
  width: min(248px, calc(var(--pet-w, 260px) - 8px));
  padding: var(--space-3);
  overflow: hidden;
  border: 1px solid var(--state-warn);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  backdrop-filter: var(--surface-blur);
  -webkit-backdrop-filter: var(--surface-blur);
  box-shadow: var(--shadow-panel);
  color: var(--text-bright);
  font-family: var(--font-ui);
  text-align: left;
  transform: translateX(-50%);
}

.permission-request > * {
  flex: none;
}

/* 只有指令區會讓出高度：先縮短程式碼框（至少一行），再不夠就在區內捲動。 */
.permission-request > .permission-details {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.permission-request.risk-high {
  border: 2px solid var(--state-error);
}

.permission-request.risk-medium {
  border-style: dashed;
}

.permission-request.risk-low {
  border-color: var(--border-strong);
}

.permission-request.risk-unknown {
  border-style: dotted;
  border-color: var(--text-secondary);
}

.permission-request-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.permission-request-source {
  flex: 0 0 auto;
  padding: 1px var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}

.permission-request-project {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-request-heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: var(--space-2) 1px;
}

.permission-request-heading strong {
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-md);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-request-queue {
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.permission-request-queue {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.permission-request-error {
  margin: 0 1px var(--space-2);
  color: var(--state-warn-bright);
  font-size: var(--font-xs);
  line-height: 1.3;
}

.permission-request .permission-queue-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 24px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  cursor: pointer;
  font-family: var(--font-ui);
}

.permission-request .permission-queue-toggle:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.permission-request-hint {
  margin: var(--space-2) 1px 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  line-height: 1.3;
}

.permission-keyboard-hint {
  display: none;
}

.permission-request:focus-within .permission-keyboard-hint {
  display: block;
}

.permission-keyboard-hint.holding {
  color: var(--state-warn-bright);
  font-weight: var(--weight-bold);
}

.permission-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.permission-request-error {
  color: var(--text-danger);
}

.permission-outcome-text {
  margin: 0 1px var(--space-2);
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
}

.permission-request-actions {
  display: grid;
  grid-template-columns: 0.82fr 1.18fr;
  gap: var(--space-2);
}

.permission-request :deep(.permission-button) {
  display: flex;
  min-width: 0;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-bright);
  cursor: pointer;
  font: var(--weight-bold) var(--font-sm) / 1 var(--font-ui);
  transition: background-color var(--transition-fast), border-color var(--transition-fast);
}

.permission-request :deep(.permission-button.allow) {
  border-color: var(--state-success);
  color: var(--state-success);
}

.permission-request :deep(.permission-button.deny) {
  color: var(--text-primary);
}

.permission-request :deep(.permission-button:hover:not(:disabled)) {
  border-color: var(--text-secondary);
  background: var(--surface-raised-hover);
}

.permission-request :deep(.permission-button:focus-visible) {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.permission-request :deep(.permission-button:disabled) {
  cursor: wait;
  opacity: 0.56;
}

.permission-keycaps {
  display: inline-flex;
  gap: var(--space-1);
}

.permission-request :deep(.permission-button kbd) {
  color: var(--text-secondary);
  font: var(--weight-medium) var(--font-xs) / 1 var(--font-ui);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .permission-request :deep(.permission-button) {
    transition: none;
  }
}

@media (prefers-contrast: more) {
  .permission-request {
    border-width: 2px;
    border-color: var(--state-warn-bright);
    background: var(--surface-overlay);
  }

  .permission-request :deep(.permission-button) {
    border-color: currentColor;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .permission-request {
    background: var(--surface-overlay);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
