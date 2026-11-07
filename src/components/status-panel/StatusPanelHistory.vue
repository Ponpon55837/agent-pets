<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { HISTORY_RANGE_OPTIONS, type HistoryAgentStat, type HistoryDailyStat, type HistoryRangeDays, type HistorySummary } from '@/types/history'
import GrowthEmptyState from '@/components/growth/GrowthEmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ProgressTrack from '@/components/ui/ProgressTrack.vue'
import Select from '@/components/ui/Select.vue'

const props = defineProps<{ active: boolean }>()
const store = useAgentStore()
const historySummary = ref<HistorySummary | null>(null)
const historyLoading = ref(false)
const historyError = ref('')
const historyAction = ref('')
const historyProjectFilter = ref('')
const RANGE_KEY = 'agent-pet-history-range'
function readRange(): HistoryRangeDays {
  try {
    const stored = Number(localStorage.getItem(RANGE_KEY))
    return HISTORY_RANGE_OPTIONS.find(option => option === stored) ?? 7
  } catch { return 7 }
}
const historyRange = ref<HistoryRangeDays>(readRange())
const RANGE_LABEL_KEYS = { 7: 'growth.range7', 30: 'growth.range30', 90: 'growth.range90' } as const
function selectRange(days: HistoryRangeDays): void {
  if (historyRange.value === days) return
  historyRange.value = days
  try { localStorage.setItem(RANGE_KEY, String(days)) } catch { /* convenience only */ }
  void refreshHistory()
}
// Compact chart labels: roughly seven labels whatever the range.
const labelStep = computed(() => Math.max(1, Math.ceil((historySummary.value?.days.length ?? 7) / 7)))
function tokenDelta(): string {
  const summary = historySummary.value
  if (!summary) return ''
  const previous = summary.previousTotals.tokenInput + summary.previousTotals.tokenOutput
  if (previous <= 0) return ''
  const current = summary.totals.tokenInput + summary.totals.tokenOutput
  const percent = Math.round(((current - previous) / previous) * 100)
  return t('growth.deltaVsPrevious', { days: summary.rangeDays, delta: `${percent > 0 ? '+' : ''}${percent}%` })
}
let cleanupHistoryUpdated: (() => void) | null = null
const progression = computed(() => store.progression)
const evolutionLabels = computed<Record<string, string>>(() => ({
  egg: t('evolutionEgg'), baby: t('evolutionBaby'), teen: t('evolutionTeen'),
  adult: t('evolutionAdult'), master: t('evolutionMaster'),
}))
const evolutionLabel = computed(() => progression.value ? evolutionLabels.value[progression.value.evolutionStage] : '')
const moodStage = computed(() => {
  if (store.mood >= 90) return t('moodOverdrive')
  if (store.mood >= 70) return t('moodRadiant')
  if (store.mood >= 40) return t('moodCharged')
  return t('moodResting')
})

const INTRO_KEY = 'agent-pet-history-intro-dismissed'
const introDismissed = ref(true)
try { introDismissed.value = localStorage.getItem(INTRO_KEY) === '1' } catch { introDismissed.value = false }
function dismissIntro(): void {
  introDismissed.value = true
  try { localStorage.setItem(INTRO_KEY, '1') } catch { /* per-viewer convenience only */ }
}
const historyIsEmpty = computed(() => {
  const summary = historySummary.value
  if (!summary) return false
  const totals = summary.totals
  return summary.agents.length === 0
    && totals.sessionsCompleted + totals.sessionsFailed + totals.activeMs + totals.tokenInput + totals.tokenOutput === 0
})

const HISTORY_TOKEN_LABEL_KEYS: Partial<Record<HistorySummary['tokenQuality'], TranslationKey>> = {
  exact: 'historyTokenExact', estimated: 'historyTokenEstimated',
}
const confirmDialog = ref<{
  title: string
  message?: string
  tone: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
} | null>(null)

const historyMaxTokens = computed(() => Math.max(
  1,
  ...(historySummary.value?.days.map(day => day.tokenInput + day.tokenOutput) ?? [1]),
))
const compactNumberFormatter = computed(() => new Intl.NumberFormat(locale.value, {
  notation: 'compact', maximumFractionDigits: 1,
}))

function onHistoryProjectFilterChange(value: string): void {
  historyProjectFilter.value = value
  void refreshHistory()
}

async function refreshHistory(): Promise<void> {
  if (historyLoading.value) return
  historyLoading.value = true
  historyError.value = ''
  try {
    const summary = await window.electronAPI?.getHistorySummary(historyProjectFilter.value || undefined, historyRange.value)
    historySummary.value = summary ?? null
    if (!summary) historyError.value = t('historyDataUnavailable')
  } catch {
    historySummary.value = null
    historyError.value = t('historyDataUnavailable')
  } finally {
    historyLoading.value = false
  }
}

function historyDateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  if (!Number.isFinite(date.getTime())) return value
  const options: Intl.DateTimeFormatOptions = historyRange.value === 7
    ? { weekday: 'short', month: 'numeric', day: 'numeric' }
    : { month: 'numeric', day: 'numeric' }
  return date.toLocaleDateString(locale.value, options)
}

function isToday(day: HistoryDailyStat): boolean {
  return historySummary.value?.localDate === day.localDate
}

// Today keeps its date and is only marked, never replaced by a word.
function historyDayLabel(day: HistoryDailyStat): string {
  return historyDateLabel(day.localDate)
}

function historyDuration(value: number): string {
  const minutes = Math.max(0, Math.round(value / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function historyTokenLabel(quality: HistorySummary['tokenQuality']): string {
  return t(HISTORY_TOKEN_LABEL_KEYS[quality] ?? 'historyTokenUnavailable')
}

function historyAgentLabel(adapterId: string): string {
  const id = adapterId.toLowerCase()
  if (id.includes('codex')) return t('clientCodex')
  if (id.includes('claude')) return t('clientClaudeCode')
  if (id.includes('opencode')) return t('clientOpenCode')
  return adapterId
}

function historyDayTokenPercent(day: HistoryDailyStat): number {
  const total = day.tokenInput + day.tokenOutput
  return Math.round((total / historyMaxTokens.value) * 100)
}

function historyDayBarHeight(day: HistoryDailyStat): number {
  const total = historyDayTokenTotal(day)
  return total > 0 ? Math.max(4, historyDayTokenPercent(day)) : 0
}

function historyDayTokenTotal(day: HistoryDailyStat): number {
  return day.tokenInput + day.tokenOutput
}

function formatCompactNumber(value: number): string {
  return compactNumberFormatter.value.format(value)
}

function historyTrackingDateLabel(): string {
  const since = historySummary.value?.tokenTrackingSince
  if (!since) return ''
  const date = new Date(since)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString(locale.value, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function historyAgentTokenTotal(agent: HistoryAgentStat): number {
  return agent.tokenInput + agent.tokenOutput
}

function historyAgentBarPercent(agent: HistoryAgentStat): number {
  const summary = historySummary.value
  if (!summary) return 0
  const totalTokens = summary.totals.tokenInput + summary.totals.tokenOutput
  if (totalTokens > 0) return Math.round((historyAgentTokenTotal(agent) / totalTokens) * 100)
  return Math.round((agent.activeMs / Math.max(1, summary.totals.activeMs)) * 100)
}

async function exportHistory(): Promise<void> {
  historyAction.value = ''
  try {
    const result = await window.electronAPI?.exportHistory()
    if (result?.ok) historyAction.value = t('historyExported')
    else if (result?.error === 'cancelled') historyAction.value = t('historyExportCancelled')
    else historyAction.value = t('historyActionFailed')
  } catch {
    historyAction.value = t('historyActionFailed')
  }
}

function askConfirm(request: NonNullable<typeof confirmDialog.value>): void {
  confirmDialog.value = request
}

async function acceptConfirm(): Promise<void> {
  const pending = confirmDialog.value
  confirmDialog.value = null
  await pending?.onConfirm()
}

function clearHistory(): void {
  askConfirm({ title: t('historyClear'), message: t('historyClearConfirm'), tone: 'danger', onConfirm: performClearHistory })
}

async function performClearHistory(): Promise<void> {
  historyAction.value = ''
  try {
    const result = await window.electronAPI?.clearHistory()
    if (result?.ok) {
      historyAction.value = t('historyCleared')
      await refreshHistory()
    } else historyAction.value = t('historyActionFailed')
  } catch {
    historyAction.value = t('historyActionFailed')
  }
}

function formatUpdated(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

watch(() => props.active, active => {
  if (active && !historySummary.value) void refreshHistory()
})
watch(() => store.projectPets, projects => {
  if (historyProjectFilter.value && !projects.some(project => project.projectId === historyProjectFilter.value)) {
    historyProjectFilter.value = ''
    if (props.active) void refreshHistory()
  }
})
onMounted(() => {
  cleanupHistoryUpdated = window.electronAPI?.onHistoryUpdated(() => {
    if (props.active) void refreshHistory()
  }) ?? null
})
onUnmounted(() => cleanupHistoryUpdated?.())
</script>

<template>
  <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" class="history-view">
    <div class="history-hero">
      <div>
        <div class="history-kicker">{{ t('historyTitle') }}</div>
        <p>{{ t('historyHelp') }}</p>
      </div>
      <div class="history-range" role="group" :aria-label="t('growth.rangeLabel')">
        <button
          v-for="days in HISTORY_RANGE_OPTIONS"
          :key="days"
          type="button"
          class="history-range-button"
          :class="{ active: historyRange === days }"
          :aria-pressed="historyRange === days"
          @click="selectRange(days)"
        >{{ t(RANGE_LABEL_KEYS[days]) }}</button>
      </div>
      <Select
        :model-value="historyProjectFilter"
        size="sm"
        class="history-project-filter"
        :aria-label="t('historyProjectFilter')"
        @update:model-value="onHistoryProjectFilterChange"
      >
        <option value="">{{ t('historyAllProjects') }}</option>
        <option v-for="project in store.projectPets" :key="project.projectId" :value="project.projectId">
          {{ project.displayName }}
        </option>
      </Select>
    </div>

    <GrowthEmptyState v-if="historyLoading && !historySummary" :title="t('checking')" busy />
    <GrowthEmptyState v-else-if="historyError && !historySummary" tone="error" icon="warning" :title="historyError">
      <Button variant="secondary" size="sm" @click="refreshHistory">{{ t('growth.retry') }}</Button>
    </GrowthEmptyState>
    <GrowthEmptyState
      v-else-if="historyIsEmpty"
      :title="t('growth.historyEmptyTitle')"
      :description="t('growth.historyEmptyBody')"
    >
      <small>{{ t('growth.historyEmptyHint') }}</small>
    </GrowthEmptyState>
    <template v-else-if="historySummary">
      <Card v-if="!introDismissed" class="history-intro" role="note">
        <strong>{{ t('growth.historyIntroTitle') }}</strong>
        <p>{{ t('growth.historyIntroBody') }}</p>
        <Button variant="secondary" size="sm" @click="dismissIntro">{{ t('growth.dismiss') }}</Button>
      </Card>
      <div class="history-stat-grid">
        <Card class="history-stat-tile history-stat-token" tone="accent">
          <span class="history-stat-label" :title="t('growth.tokenBasisTip')">{{ t('historyTokens') }}</span>
          <strong class="history-stat-number">{{ formatCompactNumber(historySummary.totals.tokenInput + historySummary.totals.tokenOutput) }}</strong>
          <span class="history-stat-meta">{{ historyTokenLabel(historySummary.tokenQuality) }}</span>
          <span v-if="tokenDelta()" class="history-stat-meta">{{ tokenDelta() }}</span>
          <span v-if="historySummary.totals.tokenCacheRead + historySummary.totals.tokenCacheWrite > 0" class="history-stat-meta" :title="t('growth.tokenBasisTip')">{{ t('growth.cacheNote', { value: formatCompactNumber(historySummary.totals.tokenCacheRead + historySummary.totals.tokenCacheWrite) }) }}</span>
        </Card>
        <Card class="history-stat-tile history-stat-sessions" tone="success">
          <span class="history-stat-label">{{ t('historyCompleted') }}</span>
          <strong class="history-stat-number">{{ historySummary.totals.sessionsCompleted }}</strong>
          <span class="history-stat-meta">{{ t('historySessions') }}</span>
        </Card>
        <Card class="history-stat-tile history-stat-time">
          <span class="history-stat-label">{{ t('historyActiveTime') }}</span>
          <strong class="history-stat-number">{{ historyDuration(historySummary.totals.activeMs) }}</strong>
          <span class="history-stat-meta">{{ t('historyRetention', { days: historySummary.retentionDays }) }}</span>
        </Card>
      </div>

      <div v-if="progression" class="history-growth-line">
        <span>{{ t('historyLevel', { level: progression.level }) }} · {{ evolutionLabel }} · {{ moodStage }}</span>
        <span>{{ t('historyStreak', { days: progression.currentStreak }) }}</span>
      </div>

      <Card class="history-chart-card" :title="t('growth.trendTitle', { days: historySummary.rangeDays })" tone="accent">
        <template #heading><span class="history-muted">{{ t('historyUpdated', { time: formatUpdated(new Date(historySummary.generatedAt).toISOString()) }) }}</span></template>
        <div class="history-bar-chart">
          <div
            v-for="(day, dayIndex) in historySummary.days"
            :key="day.localDate"
            class="history-bar-column"
            :class="{ today: isToday(day) }"
            :title="`${day.sessionsCompleted}${t('historyCompleted')} · ${day.sessionsFailed}${t('historyFailed')}`"
          >
            <span v-if="historySummary.days.length <= 7" class="history-bar-value">{{ formatCompactNumber(historyDayTokenTotal(day)) }}</span>
            <div class="history-bar-track" role="img" :aria-label="`${historyDayLabel(day)} ${historyDayTokenTotal(day)} tokens`">
              <div class="history-bar-fill" :style="{ height: `${historyDayBarHeight(day)}%` }" />
            </div>
            <span class="history-bar-label">{{ (historySummary.days.length - 1 - dayIndex) % labelStep === 0 ? historyDayLabel(day) : '' }}</span>
          </div>
        </div>
      </Card>

      <Card class="history-agent-card" :title="t('historyAgentDistribution')">
        <div v-if="historySummary.agents.length === 0" class="history-muted">{{ t('historyNoData') }}</div>
        <div v-else class="history-agent-list">
          <div v-for="agent in historySummary.agents" :key="agent.adapterId" class="history-agent-row">
            <div class="history-agent-heading"><span>{{ historyAgentLabel(agent.adapterId) }}</span><strong>{{ historyAgentTokenTotal(agent).toLocaleString(locale) }}</strong></div>
            <ProgressTrack :value="historyAgentBarPercent(agent)" tone="success" decorative />
            <div class="history-muted">{{ agent.tokenInput.toLocaleString(locale) }} {{ t('historyTokenIn') }} · {{ agent.tokenOutput.toLocaleString(locale) }} {{ t('historyTokenOut') }} · {{ historyTokenLabel(agent.tokenQuality) }}</div>
            <div class="history-muted">{{ historyDuration(agent.activeMs) }} · {{ agent.sessionsCompleted }}✓ {{ agent.sessionsFailed }}!</div>
          </div>
        </div>
      </Card>

      <div class="history-footer">
        <span>{{ t('historyCompactDisclosure', { date: historyTrackingDateLabel() }) }}</span>
        <div class="history-actions">
          <Button variant="secondary" size="sm" @click="exportHistory">{{ t('historyExportShort') }}</Button>
          <Button variant="danger" size="sm" @click="clearHistory">{{ t('historyClearShort') }}</Button>
        </div>
      </div>
    </template>
    <div v-if="historyAction" class="history-action-status" role="status" aria-live="polite">{{ historyAction }}</div>
    <ConfirmDialog
      :open="confirmDialog !== null"
      :title="confirmDialog?.title ?? ''"
      :message="confirmDialog?.message"
      :tone="confirmDialog?.tone"
      @confirm="acceptConfirm"
      @cancel="confirmDialog = null"
    />
  </div>
</template>

<style scoped>
.history-range {
  display: flex;
  gap: var(--space-1);
}

.history-range-button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

.history-range-button.active {
  border-color: var(--border-accent);
  background: var(--accent-wash);
  color: var(--text-primary);
}

.history-range-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.history-bar-column.today .history-bar-fill {
  background: var(--accent-bright);
}
</style>
