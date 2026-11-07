<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { t, translateBackendError } from '@/i18n'
import { useQuotaFormat } from '@/composables/useQuotaFormat'
import { useAgentStore } from '@/stores/agentStore'
import { quotaWindowLabel } from '@/utils/format'
import { quotaFreshness } from '@/utils/quota-math'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import GrowthEmptyState from '@/components/growth/GrowthEmptyState.vue'

const props = withDefaults(defineProps<{ nowTick: number; active?: boolean }>(), { active: true })
const store = useAgentStore()
const { formatReset, formatResetAt, formatClock, formatAge, usedRemaining, quotaTone, toneLabel } = useQuotaFormat(() => props.nowTick)

const TONE_FOR_QUOTA = { healthy: 'success', warn: 'warn', critical: 'error' } as const
const copiedProvider = ref('')
const liveStatus = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

type UsageProvider = NonNullable<typeof store.quotaUsage>['providers'][number]

const providers = computed(() => store.quotaUsage?.providers ?? [])

function errorText(provider: UsageProvider): string {
  const params = { provider: provider.name }
  switch (provider.errorKind) {
    case 'not-signed-in': return t('growth.quotaErrNotSignedIn', params)
    case 'expired': return t('growth.quotaErrExpired', params)
    case 'timeout': return t('growth.quotaErrTimeout')
    case 'rate-limited': return t('growth.quotaErrRateLimited')
    case 'unavailable': return t('growth.quotaErrUnavailable', params)
    default: return translateBackendError(provider.error)
  }
}

function fetchedMs(provider: UsageProvider): number | null {
  if (!provider.fetchedAt) return null
  const parsed = Date.parse(provider.fetchedAt)
  return Number.isFinite(parsed) ? parsed : null
}

function isStale(provider: UsageProvider): boolean {
  return provider.stale === true || quotaFreshness(fetchedMs(provider), props.nowTick) === 'stale'
}

function updatedLabel(provider: UsageProvider): string {
  const at = fetchedMs(provider)
  if (at === null) return ''
  return provider.stale ? t('growth.lastSuccess', { age: formatAge(at) }) : t('growth.updatedAgo', { age: formatAge(at) })
}

function absoluteUpdated(provider: UsageProvider): string {
  return provider.fetchedAt ? t('updated', { time: formatClock(provider.fetchedAt) }) : ''
}

async function refresh(): Promise<void> {
  await store.refreshQuota(true)
  if (store.quotaThrottleSec !== null) liveStatus.value = t('growth.refreshWait', { seconds: store.quotaThrottleSec })
  else if (store.quotaError) liveStatus.value = translateBackendError(store.quotaError)
  else liveStatus.value = `${t('growth.refreshed')} ${formatClock(Date.now())}`
}

async function copyError(provider: UsageProvider): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${provider.name}: ${provider.error ?? ''}`.trim())
    copiedProvider.value = provider.id
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedProvider.value = '' }, 2_000)
  } catch {
    copiedProvider.value = ''
  }
}

function syncPolling(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (!props.active) return
  // Opening the tab refreshes when the reading is older than the poll period;
  // while it stays open the panel keeps its own cadence.
  void store.refreshQuota()
  pollTimer = setInterval(() => {
    if (!document.hidden) void store.refreshQuota()
  }, store.quotaRefreshMs)
}

watch(() => props.active, syncPolling, { immediate: true })
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div id="panel-usage" role="tabpanel" aria-labelledby="tab-usage" class="usage-view" :aria-busy="store.quotaLoading ? 'true' : undefined">
    <GrowthEmptyState v-if="store.quotaLoading && !store.quotaUsage" :title="t('growth.quotaLoading')" busy />
    <GrowthEmptyState
      v-else-if="!store.quotaUsage && store.quotaError"
      tone="error"
      icon="warning"
      :title="t('quotaLoadFailed')"
      :description="translateBackendError(store.quotaError)"
    >
      <Button variant="secondary" size="sm" @click="refresh">{{ t('growth.retry') }}</Button>
    </GrowthEmptyState>
    <GrowthEmptyState
      v-else-if="!store.quotaUsage"
      :title="t('growth.quotaEmptyTitle')"
      :description="t('growth.quotaEmptyBody')"
    >
      <Button variant="secondary" size="sm" :disabled="store.quotaLoading" @click="refresh">{{ t('refresh') }}</Button>
    </GrowthEmptyState>
    <template v-else>
      <div v-if="store.quotaError" class="usage-banner" role="alert">
        <Icon name="warning" :size="14" />
        <span>{{ translateBackendError(store.quotaError) }}</span>
        <Button variant="ghost" size="sm" @click="refresh">{{ t('growth.retry') }}</Button>
      </div>
      <Card
        v-for="provider in providers"
        :key="provider.id"
        class="usage-provider-card"
        :tone="provider.id === 'claude' ? 'claude' : 'accent'"
      >
        <template #heading>
          <span class="usage-provider-name">{{ provider.name }}</span>
          <span v-if="provider.plan" class="usage-plan" :class="`plan-${provider.id}`">{{ provider.plan }}</span>
          <span v-if="updatedLabel(provider)" class="usage-updated" :title="absoluteUpdated(provider)">{{ updatedLabel(provider) }}</span>
        </template>
        <div v-if="provider.error" class="usage-provider-error" role="alert">
          <Icon name="warning" :size="14" />
          <div class="usage-error-body">
            <span>{{ errorText(provider) }}</span>
            <span v-if="provider.windows.length > 0" class="usage-error-note">{{ t('growth.quotaKeptLast') }}</span>
            <div class="usage-error-actions">
              <Button variant="secondary" size="sm" :disabled="store.quotaLoading" @click="refresh">{{ t('growth.retry') }}</Button>
              <Button variant="ghost" size="sm" @click="copyError(provider)">
                {{ copiedProvider === provider.id ? t('growth.copied') : t('growth.copyError') }}
              </Button>
            </div>
          </div>
        </div>
        <div v-if="provider.windows.length > 0" class="quota-window-list" :class="{ 'is-stale': isStale(provider) }">
          <div v-if="isStale(provider)" class="usage-stale-note">{{ t('growth.stalePossible') }}</div>
          <div v-for="quota in provider.windows" :key="quota.id" class="quota-window">
            <div class="quota-copy">
              <span class="quota-label">{{ quotaWindowLabel(quota.id, quota.label) }}</span>
              <span class="quota-value">{{ usedRemaining(quota.usedPercent, quota.remainingPercent) }}</span>
            </div>
            <ProgressTrack
              class="quota-progress"
              :value="quota.remainingPercent"
              :value-text="[usedRemaining(quota.usedPercent, quota.remainingPercent), formatReset(quota.resetsAt)].filter(Boolean).join(', ')"
              :tone="TONE_FOR_QUOTA[quotaTone(quota.remainingPercent)]"
              :aria-label="t('quotaRemainingAria', { provider: provider.name, quota: quotaWindowLabel(quota.id, quota.label) })"
            />
            <div
              v-if="quotaTone(quota.remainingPercent) !== 'healthy' || quota.overage"
              class="quota-warning"
              :class="{ critical: quotaTone(quota.remainingPercent) === 'critical' }"
            >
              <Icon name="warning" :size="14" />
              <span>{{ toneLabel(quotaTone(quota.remainingPercent), quota.overage) }}</span>
            </div>
            <div class="quota-reset">
              <span :title="formatResetAt(quota.resetsAt) || undefined">{{ formatReset(quota.resetsAt) }}</span>
            </div>
          </div>
        </div>
      </Card>
      <div class="usage-footer">
        <span>{{ t('growth.autoRefreshNote') }}</span>
        <Button variant="secondary" size="sm" :disabled="store.quotaLoading" @click="refresh">
          <span v-if="store.quotaLoading" class="usage-spinner" aria-hidden="true" />
          {{ store.quotaLoading ? t('refreshing') : t('growth.refreshNow') }}
        </Button>
      </div>
      <div class="usage-live" role="status" aria-live="polite">{{ liveStatus }}</div>
    </template>
  </div>
</template>

<style scoped>
.usage-banner,
.usage-provider-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--state-error);
  font-size: var(--font-sm);
}

.usage-banner {
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--state-error);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.usage-banner span {
  flex: 1;
}

.usage-error-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.usage-error-note,
.usage-stale-note {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.usage-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.quota-window-list.is-stale .quota-value,
.quota-window-list.is-stale .quota-label {
  opacity: 0.75;
}

.quota-warning {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--state-warn-bright);
  font-size: var(--font-xs);
}

.quota-warning.critical {
  color: var(--state-error);
}

.usage-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: var(--space-2);
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent-bright);
  border-radius: var(--radius-pill);
  animation: usage-spin 0.9s linear infinite;
}

.usage-live {
  min-height: 1em;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

@keyframes usage-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .usage-spinner {
    animation: none;
    border-top-color: var(--border-strong);
  }
}
</style>
