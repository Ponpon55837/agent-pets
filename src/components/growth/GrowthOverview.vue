<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { locale, t } from '@/i18n'
import { useProgressionLabels } from '@/composables/useProgressionLabels'
import { useAgentStore } from '@/stores/agentStore'
import { nextEvolution, type ProgressionInsights } from '@/types/progression'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const { evolutionLabel, moodStage, ruleLabel, xpSources } = useProgressionLabels()
const progression = computed(() => store.progression)
const insights = ref<ProgressionInsights | null>(null)

const progressionPercent = computed(() => {
  if (!progression.value) return 0
  return Math.min(100, Math.round((progression.value.xpIntoLevel / progression.value.xpToNext) * 100))
})

const nextStage = computed(() => (progression.value ? nextEvolution(progression.value.level) : null))

async function loadInsights(): Promise<void> {
  try {
    insights.value = (await window.electronAPI?.getProgressionInsights()) ?? null
  } catch {
    insights.value = null
  }
}

function entryTime(timestamp: number): string {
  const date = new Date(timestamp)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale.value, { month: 'numeric', day: 'numeric' })
}

// The ledger lives in main; re-read it whenever main reports new XP or the
// selected pet's snapshot changes so the list survives restarts and stays live.
watch(() => [progression.value?.petId, progression.value?.totalXp], () => { void loadInsights() })
onMounted(() => { void loadInsights() })
</script>

<template>
  <Card :title="t('petMood')">
    <template #heading>
      <Button size="sm" variant="secondary" :title="t('resetBaseline')" @click="store.resetMood()">{{ t('reset') }}</Button>
    </template>
    <div class="stat-row"><span class="stat-readout">{{ store.mood }} · {{ moodStage }}</span></div>
    <ProgressTrack :value="store.mood" tone="success" :aria-label="t('petMood')" />
  </Card>

  <template v-if="progression">
    <Card :title="t('growth')" tone="accent">
      <template #heading><span class="stat-readout">{{ progression.totalXp }} XP</span></template>
      <div class="stat-row"><span class="stat-readout">Lv {{ progression.level }} · {{ evolutionLabel(progression.evolutionStage) }}</span></div>
      <ProgressTrack :value="progressionPercent" :aria-label="t('growth')" />
      <div class="stat-row muted">
        <span v-if="nextStage">{{ t('growth.nextEvolution', { level: nextStage.level, stage: evolutionLabel(nextStage.stage), levels: nextStage.level - progression.level }) }}</span>
        <span v-else>{{ t('growth.finalStage') }}</span>
      </div>
      <div class="stat-row muted">
        <span>{{ t('toNextLevel', { value: `${progression.xpIntoLevel} / ${progression.xpToNext}` }) }}</span>
        <span v-if="progression.currentStreak > 0">{{ t('dayStreak', { days: progression.currentStreak }) }}</span>
        <span v-else>{{ t('startStreak') }}</span>
      </div>
    </Card>

    <Card :title="t('growth.recentTitle')">
      <ul v-if="insights && insights.recent.length > 0" class="growth-ledger" :aria-label="t('growth.recentTitle')">
        <li v-for="(entry, index) in insights.recent" :key="`${entry.occurredAt}:${entry.ruleId}:${index}`" class="growth-ledger-row">
          <span class="growth-ledger-time">{{ entryTime(entry.occurredAt) }}</span>
          <span class="growth-ledger-rule">{{ ruleLabel(entry.ruleId) }}</span>
          <strong class="growth-ledger-amount">{{ t('growth.xpAmount', { amount: entry.amount }) }}</strong>
        </li>
      </ul>
      <p v-else class="growth-hint">{{ t('growth.recentEmpty') }}</p>
      <details class="growth-sources">
        <summary>{{ t('growth.xpSourcesTitle') }}</summary>
        <ul>
          <li v-for="source in xpSources" :key="source">{{ source }}</li>
        </ul>
      </details>
    </Card>

    <Card :title="t('moodVisuals')">
      <ToggleRow :model-value="store.moodVisualsEnabled" :label="t('moodVisuals')" :help="t('moodVisualsHelp')" @update:model-value="store.setMoodVisualsEnabled($event)" />
    </Card>
  </template>
  <div v-else class="growth-unavailable" role="status">{{ t('growthDataUnavailable') }}</div>
</template>

<style scoped>
.growth-ledger {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.growth-ledger-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--font-sm);
}

.growth-ledger-time {
  color: var(--text-muted);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}

.growth-ledger-rule {
  color: var(--text-secondary);
}

.growth-ledger-amount {
  color: var(--state-success);
  font-variant-numeric: tabular-nums;
}

.growth-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.growth-sources {
  margin-top: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.growth-sources summary {
  cursor: pointer;
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}

.growth-sources summary:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
  border-radius: var(--radius-sm);
}

.growth-sources ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
}
</style>
