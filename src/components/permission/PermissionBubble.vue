<script setup lang="ts">
import { computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t, type TranslationKey } from '@/i18n'
import { permissionSourceName } from '@/utils/permission-source'
import type { PermissionOutcomeKind } from '@/types/permission'
import PermissionRiskBadge from '@/components/permission/PermissionRiskBadge.vue'
import PermissionDetails from '@/components/permission/PermissionDetails.vue'
import PermissionCountdown from '@/components/permission/PermissionCountdown.vue'
import { usePermissionClock } from '@/components/permission/usePermissionClock'

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

function decide(decision: 'allow_once' | 'deny'): void {
  const current = request.value
  if (!current || current.status !== 'pending') return
  void store.decidePermission(current.requestId, decision)
}
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
  >
    <header class="permission-request-header">
      <span class="permission-request-source">{{ permissionSourceName(request.agentId) }}</span>
      <span class="permission-request-project" :title="request.projectId">{{ request.projectId || t('projectUnknown') }}</span>
      <span class="permission-request-queue">{{ request.queuePosition }}/{{ request.queueSize }}</span>
    </header>
    <p class="permission-request-heading">
      <strong id="permission-request-title">{{ request.action }}</strong>
      <PermissionRiskBadge :risk="request.risk" :network="request.network" />
    </p>
    <PermissionDetails :request="request" id-prefix="permission-request" />
    <PermissionCountdown :request="request" :now="now" />
    <p v-if="inlineError" class="permission-request-error" role="alert">{{ inlineError }}</p>
    <div class="permission-request-actions">
      <button
        type="button"
        class="permission-button deny"
        :disabled="request.status !== 'pending'"
        @mousedown.stop
        @click.stop="decide('deny')"
      >
        {{ t('permissionDeny') }}
        <kbd v-if="request.hotkeyEligible">Ctrl Shift N</kbd>
      </button>
      <button
        type="button"
        class="permission-button allow"
        :disabled="request.status !== 'pending'"
        @mousedown.stop
        @click.stop="decide('allow_once')"
      >
        {{ request.status === 'deciding' ? t('sending') : t('permissionAllowOnce') }}
        <kbd v-if="request.hotkeyEligible">Ctrl Shift Y</kbd>
      </button>
    </div>
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
      <button type="button" class="permission-button deny" @mousedown.stop @click.stop="store.dismissPermissionOutcome()">
        {{ t('permission.dismiss') }}
      </button>
      <button type="button" class="permission-button allow" @mousedown.stop @click.stop="store.togglePanel()">
        {{ t('permission.viewInPanel') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
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
  line-height: 1.25;
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

.permission-request-error {
  color: var(--state-error-soft);
}

.permission-outcome-text {
  margin: 0 1px var(--space-2);
  font-size: var(--font-sm);
  line-height: 1.4;
}

.permission-request-actions {
  display: grid;
  grid-template-columns: 0.82fr 1.18fr;
  gap: var(--space-2);
}

.permission-button {
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

.permission-button.allow {
  border-color: var(--state-success);
  color: var(--state-success);
}

.permission-button.deny {
  color: var(--text-primary);
}

.permission-button:hover:not(:disabled) {
  border-color: var(--text-secondary);
  background: var(--surface-raised-hover);
}

.permission-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.permission-button:disabled {
  cursor: wait;
  opacity: 0.56;
}

.permission-button kbd {
  color: var(--text-secondary);
  font: var(--weight-medium) var(--font-xs) / 1 var(--font-ui);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .permission-button {
    transition: none;
  }
}

@media (prefers-contrast: more) {
  .permission-request {
    border-width: 2px;
    border-color: var(--state-warn-bright);
    background: var(--surface-overlay);
  }

  .permission-button {
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
