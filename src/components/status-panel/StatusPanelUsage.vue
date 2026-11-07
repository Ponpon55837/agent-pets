<script setup lang="ts">
import { t, translateBackendError } from '@/i18n'
import { useQuotaFormat } from '@/composables/useQuotaFormat'
import { useAgentStore } from '@/stores/agentStore'
import { quotaWindowLabel } from '@/utils/format'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'

const props = defineProps<{ nowTick: number }>()
const store = useAgentStore()
const { formatReset, formatResetAt, formatClock, usedRemaining, quotaTone, toneLabel } = useQuotaFormat(() => props.nowTick)

const TONE_FOR_QUOTA = { healthy: 'success', warn: 'warn', critical: 'error' } as const
</script>

<template>
  <div id="panel-usage" role="tabpanel" aria-labelledby="tab-usage" class="usage-view">
    <div v-if="store.quotaLoading && !store.quotaUsage" class="panel-empty usage-loading">
      {{ t('loadingQuota') }}
    </div>
    <div v-else-if="store.quotaError && !store.quotaUsage" class="panel-empty usage-error">
      {{ translateBackendError(store.quotaError) }}
    </div>
    <template v-else-if="store.quotaUsage">
      <Card
        v-for="provider in store.quotaUsage.providers"
        :key="provider.id"
        class="usage-provider-card"
        :tone="provider.id === 'claude' ? 'claude' : 'accent'"
      >
        <template #heading>
          <span class="usage-provider-name">{{ provider.name }}</span>
          <span v-if="provider.plan" class="usage-plan" :class="`plan-${provider.id}`">{{ provider.plan }}</span>
          <span class="usage-updated">{{ t('updated', { time: formatClock(store.quotaUsage.updatedAt) }) }}</span>
        </template>
        <div v-if="provider.error" class="usage-provider-error">
          {{ translateBackendError(provider.error) }}
        </div>
        <div v-else class="quota-window-list">
          <div v-for="quota in provider.windows" :key="quota.id" class="quota-window">
            <div class="quota-copy">
              <span class="quota-label">{{ quotaWindowLabel(quota.id, quota.label) }}</span>
              <span class="quota-value">{{ usedRemaining(quota.usedPercent, quota.remainingPercent) }}</span>
            </div>
            <ProgressTrack
              class="quota-progress"
              :value="quota.remainingPercent"
              :tone="TONE_FOR_QUOTA[quotaTone(quota.remainingPercent)]"
              :aria-label="t('quotaRemainingAria', { provider: provider.name, quota: quotaWindowLabel(quota.id, quota.label) })"
            />
            <div
              v-if="quotaTone(quota.remainingPercent) !== 'healthy' || quota.overage"
              class="quota-warning"
              :class="{ critical: quotaTone(quota.remainingPercent) === 'critical' }"
              role="status"
            >
              <Icon name="warning" :size="14" />
              <span>{{ toneLabel(quotaTone(quota.remainingPercent), quota.overage) }}</span>
            </div>
            <div class="quota-reset">
              <span>{{ formatReset(quota.resetsAt) }}</span>
              <span v-if="formatResetAt(quota.resetsAt)" class="quota-reset-at">
                {{ formatResetAt(quota.resetsAt) }}
              </span>
            </div>
          </div>
        </div>
      </Card>
      <div class="usage-footer">
        <span>{{ t('quotaLocalLoginNote') }}</span>
        <Button variant="secondary" size="sm" :disabled="store.quotaLoading" @click="store.refreshQuota(true)">
          {{ store.quotaLoading ? t('refreshing') : t('refresh') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
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
</style>
