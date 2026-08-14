<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from '../stores/agentStore'
import { STATE_LABELS, SOURCE_LABELS, STATE_COLORS, STATE_PRIORITY, SOURCE_FAMILIES } from '../types/agent'
import { formatProject } from '../utils/format'
import { locale, t, translateBackendError } from '../i18n'
import type { HistoryAgentStat, HistoryDailyStat, HistorySummary } from '../types/history'
import Button from './ui/Button.vue'
import Card from './ui/Card.vue'
import ConfirmDialog from './ui/ConfirmDialog.vue'
import Icon from './ui/Icon.vue'
import ProgressTrack from './ui/ProgressTrack.vue'
import Select from './ui/Select.vue'
import ToggleRow from './ui/ToggleRow.vue'

const store = useAgentStore()
const importing = ref(false)
const editingPetId = ref<string | null>(null)
const editName = ref('')

type SettingsSection = 'language' | 'appearance' | 'desktop' | 'pets' | 'growth' | 'advanced'
const settingsTab = ref<SettingsSection>('appearance')
const settingsSections = computed<Array<{ id: SettingsSection; icon: string; label: string; hint: string }>>(() => [
  { id: 'language', icon: 'language', label: t('language'), hint: t('languageHint') },
  { id: 'appearance', icon: 'appearance', label: t('appearance'), hint: t('appearanceHint') },
  { id: 'desktop', icon: 'desktop', label: t('desktop'), hint: t('desktopHint') },
  { id: 'pets', icon: 'pets', label: t('pets'), hint: t('petsHint') },
  { id: 'growth', icon: 'growth', label: t('growth'), hint: t('growthHint') },
  { id: 'advanced', icon: 'advanced', label: t('advanced'), hint: t('advancedHint') },
])
const activeSettingsSection = computed(() => settingsSections.value.find(section => section.id === settingsTab.value))
type DashboardTab = 'sessions' | 'usage' | 'history'
const dashboardTab = ref<DashboardTab>('sessions')
const dashboardTabs = computed<Array<{ id: DashboardTab; label: string }>>(() => [
  { id: 'sessions', label: t('sessions') },
  { id: 'usage', label: t('tokenRemaining') },
  { id: 'history', label: t('history') },
])

// Arrow-key navigation is expected of role="tablist" and was missing.
function onTabKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const ids = dashboardTabs.value.map(tab => tab.id)
  const next = ids[(ids.indexOf(dashboardTab.value) + step + ids.length) % ids.length]
  selectDashboardTab(next)
  ;(document.getElementById(`tab-${next}`) as HTMLElement | null)?.focus()
}
const historySummary = ref<HistorySummary | null>(null)
const historyLoading = ref(false)
const historyError = ref('')
const historyAction = ref('')
const historyProjectFilter = ref('')
let cleanupHistoryUpdated: (() => void) | null = null
const quotaUsage = computed(() => store.quotaUsage)
const quotaLoading = computed(() => store.quotaLoading)
const quotaError = computed(() => store.quotaError)
const progression = computed(() => store.progression)
const evolutionLabels = computed<Record<string, string>>(() => ({
  egg: t('evolutionEgg'),
  baby: t('evolutionBaby'),
  teen: t('evolutionTeen'),
  adult: t('evolutionAdult'),
  master: t('evolutionMaster'),
}))
const evolutionLabel = computed(() => (
  progression.value ? evolutionLabels.value[progression.value.evolutionStage] : ''
))
const progressionPercent = computed(() => {
  if (!progression.value) return 0
  return Math.min(100, Math.round((progression.value.xpIntoLevel / progression.value.xpToNext) * 100))
})
const moodStage = computed(() => {
  if (store.mood >= 90) return t('moodOverdrive')
  if (store.mood >= 70) return t('moodRadiant')
  if (store.mood >= 40) return t('moodCharged')
  return t('moodResting')
})

watch(() => store.panelView, (view) => {
  if (view === 'settings') settingsTab.value = 'appearance'
})

watch(() => store.projectPets, (projects) => {
  if (historyProjectFilter.value && !projects.some(project => project.projectId === historyProjectFilter.value)) {
    historyProjectFilter.value = ''
    if (dashboardTab.value === 'history') void refreshHistory()
  }
})

// Drives the "Xs" elapsed-time readout on in-flight sessions (thinking /
// tool-running / waiting-*), matching the "Churning 7.2s" style loader.
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

async function refreshQuota(force = false) {
  await store.refreshQuota(force)
}

function selectDashboardTab(tab: 'sessions' | 'usage' | 'history') {
  dashboardTab.value = tab
  if (tab === 'usage' && !quotaUsage.value) void refreshQuota()
  if (tab === 'history' && !historySummary.value) void refreshHistory()
}

function onHistoryProjectFilterChange(value: string): void {
  historyProjectFilter.value = value
  void refreshHistory()
}

async function refreshHistory(): Promise<void> {
  if (historyLoading.value) return
  historyLoading.value = true
  historyError.value = ''
  try {
    const summary = await window.electronAPI?.getHistorySummary(historyProjectFilter.value || undefined)
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
  // Weekday + date used to be requested here ("週三 8/13"), but that string
  // is wider than the 7-day chart's label column in both locales and wraps
  // to two lines, which staggers every row under it — see history-day-row.
  return date.toLocaleDateString(locale.value, { month: 'numeric', day: 'numeric' })
}

function historyDayLabel(day: HistoryDailyStat): string {
  if (historySummary.value?.days.at(-1)?.localDate === day.localDate) return t('historyToday')
  return historyDateLabel(day.localDate)
}

function historyDuration(value: number): string {
  const minutes = Math.max(0, Math.round(value / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function historyTokenLabel(quality: HistorySummary['tokenQuality']): string {
  if (quality === 'exact') return t('historyTokenExact')
  if (quality === 'estimated') return t('historyTokenEstimated')
  return t('historyTokenUnavailable')
}

function historyAgentLabel(adapterId: string): string {
  const id = adapterId.toLowerCase()
  if (id.includes('codex')) return t('clientCodex')
  if (id.includes('claude')) return t('clientClaudeCode')
  if (id.includes('opencode')) return t('clientOpenCode')
  return adapterId
}

function projectPetStatusLabel(status: 'unbound' | 'bound' | 'missing-pet'): string {
  if (status === 'bound') return t('projectPetBound')
  if (status === 'missing-pet') return t('projectPetMissing')
  return t('projectPetUnbound')
}

const historyMaxTokens = computed(() => Math.max(
  1,
  ...(historySummary.value?.days.map(day => day.tokenInput + day.tokenOutput) ?? [1]),
))

// ProgressTrack takes a 0-100 number and does its own clamping, so this
// returns a percentage rather than the CSS width string it used to build.
function historyDayTokenPercent(day: HistoryDailyStat): number {
  const total = day.tokenInput + day.tokenOutput
  return Math.round((total / historyMaxTokens.value) * 100)
}

function historyDayTokenTotal(day: HistoryDailyStat): number {
  return day.tokenInput + day.tokenOutput
}

// The day column is too narrow for a raw token count once it hits five or
// six digits, so this renders "12.3k" the way the pet's own quota readouts
// already do elsewhere in the panel.
const compactNumberFormatter = computed(() => new Intl.NumberFormat(locale.value, {
  notation: 'compact',
  maximumFractionDigits: 1,
}))

function formatCompactNumber(value: number): string {
  return compactNumberFormatter.value.format(value)
}

function historyTrackingSinceLabel(): string {
  const since = historySummary.value?.tokenTrackingSince
  if (!since) return ''
  const date = new Date(since)
  if (!Number.isFinite(date.getTime())) return ''
  return t('historyTrackingSince', {
    date: date.toLocaleDateString(locale.value, { year: 'numeric', month: '2-digit', day: '2-digit' }),
  })
}

function historyAgentTokenTotal(agent: HistoryAgentStat): number {
  return agent.tokenInput + agent.tokenOutput
}

function historyAgentBarPercent(agent: HistoryAgentStat): number {
  const summary = historySummary.value
  if (!summary) return 0
  const totalTokens = summary.totals.tokenInput + summary.totals.tokenOutput
  if (totalTokens > 0) {
    return Math.round((historyAgentTokenTotal(agent) / totalTokens) * 100)
  }
  const totalActiveMs = Math.max(1, summary.totals.activeMs)
  return Math.round((agent.activeMs / totalActiveMs) * 100)
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

// One in-panel confirmation flow for every destructive action. A native
// window.confirm() would steal focus, which the main process reads as a blur
// and hides the panel mid-confirmation.
const confirmDialog = ref<{
  title: string
  message?: string
  tone: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
} | null>(null)

function askConfirm(request: NonNullable<typeof confirmDialog.value>) {
  confirmDialog.value = request
}

async function acceptConfirm() {
  const pending = confirmDialog.value
  confirmDialog.value = null
  await pending?.onConfirm()
}

function clearHistory(): void {
  askConfirm({
    title: t('historyClear'),
    message: t('historyClearConfirm'),
    tone: 'danger',
    onConfirm: performClearHistory,
  })
}

async function performClearHistory(): Promise<void> {
  historyAction.value = ''
  try {
    const result = await window.electronAPI?.clearHistory()
    if (result?.ok) {
      historyAction.value = t('historyCleared')
      await refreshHistory()
    } else {
      historyAction.value = t('historyActionFailed')
    }
  } catch {
    historyAction.value = t('historyActionFailed')
  }
}

function formatRemaining(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return t('remainingPercent', { value: rounded })
}

function formatQuotaLabel(id: string, label: string): string {
  const identity = `${id} ${label}`.toLowerCase()
  if (identity.includes('session') || identity.includes('five_hour')) return t('fiveHourLimit')
  if (identity.includes('weekly') || identity.includes('seven_day')) return t('weeklyLimit')
  return label
}

function formatReset(timestamp?: string): string {
  if (!timestamp) return t('resetTimeUnavailable')
  const reset = new Date(timestamp).getTime()
  if (!Number.isFinite(reset)) return t('resetTimeUnavailable')
  const deltaMinutes = Math.max(0, Math.round((reset - nowTick.value) / 60_000))
  if (deltaMinutes < 1) return t('resetsNow')
  if (deltaMinutes < 60) return t('resetsInMinutes', { minutes: deltaMinutes })
  const hours = Math.floor(deltaMinutes / 60)
  const minutes = deltaMinutes % 60
  if (hours < 24) return t('resetsInHours', { hours, minutes })
  const days = Math.floor(hours / 24)
  return t('resetsInDays', { days, hours: hours % 24 })
}

function formatResetAt(timestamp?: string): string {
  if (!timestamp) return ''
  const reset = new Date(timestamp)
  if (!Number.isFinite(reset.getTime())) return ''
  return reset.toLocaleString(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUpdated(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

const LIVE_STATES = new Set(['thinking', 'tool-running', 'waiting-permission', 'waiting-input'])

function elapsedLabel(session: { state: string; lastSeenAt: number }): string | null {
  if (!LIVE_STATES.has(session.state)) return null
  const secs = Math.max(0, (nowTick.value - session.lastSeenAt) / 1000)
  return `${secs.toFixed(1)}s`
}

// Pet + panel are separate windows with separate store instances now — this
// window must load its own copy of the pets list rather than relying on the
// pet window having already populated it.
onMounted(() => {
  store.loadPets()
  void store.refreshProjectPets()
  if (window.electronAPI?.onHistoryUpdated) {
    cleanupHistoryUpdated = window.electronAPI.onHistoryUpdated(() => {
      if (dashboardTab.value === 'history') void refreshHistory()
    })
  }
})

onUnmounted(() => {
  cleanupHistoryUpdated?.()
})

function startRename(pet: { id: string; displayName: string }) {
  editingPetId.value = pet.id
  editName.value = pet.displayName
}

async function confirmRename() {
  if (!editingPetId.value || !editName.value.trim()) {
    editingPetId.value = null
    return
  }
  await store.renamePet(editingPetId.value, editName.value.trim())
  editingPetId.value = null
}

function cancelRename() {
  editingPetId.value = null
  editName.value = ''
}

const sessions = computed(() => {
  return Object.values(store.sessions).sort((a, b) => {
    const priorityDelta = (STATE_PRIORITY[b.state] ?? 0) - (STATE_PRIORITY[a.state] ?? 0)
    if (priorityDelta !== 0) return priorityDelta

    const recencyDelta = b.lastSeenAt - a.lastSeenAt
    if (recencyDelta !== 0) return recencyDelta

    return SOURCE_LABELS[a.source].localeCompare(SOURCE_LABELS[b.source])
  })
})

const hasOffline = computed(() => sessions.value.some((s) => s.state === 'offline'))

const scaleOptions = [
  { value: 0.6, label: 'S' },
  { value: 0.8, label: 'M' },
  { value: 1.0, label: 'L' },
  { value: 1.2, label: 'XL' },
  { value: 1.5, label: 'XXL' },
]

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(locale.value)
}

async function importPet() {
  importing.value = true
  const id = `custom-${Date.now()}`
  const fileUrl = await window.electronAPI?.importPetSprite(id, t('customPet'))
  if (fileUrl) {
    await store.loadPets()
    store.setPet(id)
  }
  importing.value = false
}

const importingZip = ref(false)
const importZipError = ref('')

async function importPetZip() {
  importingZip.value = true
  importZipError.value = ''
  const result = await window.electronAPI?.importPetZip()
  if (result?.ok && result.id) {
    await store.loadPets()
    store.setPet(result.id)
  } else if (result && !result.ok && result.error !== 'cancelled') {
    importZipError.value = translateBackendError(result.error || t('failed'))
  }
  importingZip.value = false
}

function quitApp() {
  window.electronAPI?.quitApp()
}

function restartApp() {
  window.electronAPI?.restartApp()
}

function confirmRemovePet(pet: { id: string; displayName: string; builtIn: boolean }) {
  askConfirm({
    title: pet.builtIn ? t('hide') : t('remove'),
    message: pet.builtIn
      ? t('hidePetConfirm', { name: pet.displayName })
      : t('removePetConfirm', { name: pet.displayName }),
    tone: 'danger',
    onConfirm: () => store.removePet(pet.id),
  })
}

function confirmRemoveProjectPet(project: { projectId: string; displayName: string }) {
  askConfirm({
    title: t('remove'),
    message: t('removeProjectPetConfirm', { name: project.displayName }),
    tone: 'danger',
    onConfirm: () => { void store.removeProjectPet(project.projectId) },
  })
}
</script>

<template>
  <div class="status-panel" @click.stop>
    <div class="panel-header">
      <Button
        v-if="store.panelView === 'settings'"
        variant="ghost"
        icon-only
        :title="t('back')"
        :aria-label="t('back')"
        @click="store.backToSessions()"
      >
        <Icon name="back" />
      </Button>
      <span class="panel-title">
        {{ store.panelView === 'sessions' ? t('appName') : t('settings') }}
      </span>
      <div class="header-right">
        <Button
          v-if="store.panelView === 'sessions'"
          variant="ghost"
          icon-only
          :title="t('settings')"
          :aria-label="t('settings')"
          @click="store.openSettings()"
        >
          <Icon name="settings" />
        </Button>
        <Button
          variant="ghost"
          icon-only
          :title="t('close')"
          :aria-label="t('close')"
          @click="store.closePanel()"
        >
          <Icon name="close" />
        </Button>
      </div>
    </div>

    <template v-if="store.panelView === 'sessions'">
      <div class="dashboard-tabs" role="tablist" :aria-label="t('dashboardSections')">
        <button
          v-for="tab in dashboardTabs"
          :key="tab.id"
          class="dashboard-tab"
          :class="{ active: dashboardTab === tab.id }"
          role="tab"
          :id="`tab-${tab.id}`"
          :aria-selected="dashboardTab === tab.id"
          :aria-controls="`panel-${tab.id}`"
          :tabindex="dashboardTab === tab.id ? 0 : -1"
          @click="selectDashboardTab(tab.id)"
          @keydown="onTabKeydown"
        >
          {{ tab.label }}
        </button>
      </div>

      <template v-if="dashboardTab === 'sessions'">
        <div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" class="tab-panel">
        <div v-if="sessions.length === 0" class="panel-empty">
          {{ t('noActiveSessions') }}
        </div>
        <template v-else>
          <div class="session-list">
            <div
              v-for="session in sessions"
              :key="session.key"
              class="session-item"
            >
              <div class="session-source">
                {{ SOURCE_LABELS[session.source] }}
              </div>
              <div class="session-info">
                <span
                  class="state-chip"
                  :class="{ live: LIVE_STATES.has(session.state) }"
                  :style="{ color: STATE_COLORS[session.state], borderColor: STATE_COLORS[session.state] + '40', background: STATE_COLORS[session.state] + '1a' }"
                >
                  <span class="state-dot" :style="{ background: STATE_COLORS[session.state] }" />
                  {{ STATE_LABELS[session.state] }}
                  <span v-if="elapsedLabel(session)" class="state-elapsed">{{ elapsedLabel(session) }}</span>
                </span>
                <span v-if="session.project" class="session-project">
                  {{ formatProject(session.project) }}
                </span>
              </div>
              <div class="session-time">
                {{ formatTime(session.lastSeenAt) }}
              </div>
            </div>
          </div>
          <div v-if="hasOffline" class="session-footer">
            <Button variant="secondary" size="sm" @click="store.clearOfflineSessions()">
              {{ t('clearOffline') }}
            </Button>
          </div>
        </template>
        </div>
      </template>

      <template v-else-if="dashboardTab === 'usage'">
        <div id="panel-usage" role="tabpanel" aria-labelledby="tab-usage" class="usage-view">
          <div v-if="quotaLoading && !quotaUsage" class="panel-empty usage-loading">
            {{ t('loadingQuota') }}
          </div>
          <div v-else-if="quotaError && !quotaUsage" class="panel-empty usage-error">
            {{ translateBackendError(quotaError) }}
          </div>
          <template v-else-if="quotaUsage">
            <Card
              v-for="provider in quotaUsage.providers"
              :key="provider.id"
              :tone="provider.id === 'claude' ? 'claude' : 'accent'"
            >
              <template #heading>
                <span class="usage-provider-name">{{ provider.name }}</span>
                <span v-if="provider.plan" class="usage-plan">{{ provider.plan }}</span>
              </template>
              <div v-if="provider.error" class="usage-provider-error">
                {{ translateBackendError(provider.error) }}
              </div>
              <div v-else class="quota-window-list">
                <div v-for="quota in provider.windows" :key="quota.id" class="quota-window">
                  <div class="quota-copy">
                    <span class="quota-label">{{ formatQuotaLabel(quota.id, quota.label) }}</span>
                    <span class="quota-value">{{ formatRemaining(quota.remainingPercent) }}</span>
                  </div>
                  <ProgressTrack
                    class="quota-progress"
                    :value="quota.remainingPercent"
                    :tone="provider.id === 'claude' ? 'claude' : 'accent'"
                    :aria-label="t('quotaRemainingAria', { provider: provider.name, quota: formatQuotaLabel(quota.id, quota.label) })"
                  />
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
              <span>{{ t('updated', { time: formatUpdated(quotaUsage.updatedAt) }) }}</span>
              <Button variant="secondary" size="sm" :disabled="quotaLoading" @click="refreshQuota(true)">
                {{ quotaLoading ? t('refreshing') : t('refresh') }}
              </Button>
            </div>
          </template>
        </div>
      </template>

      <template v-else>
        <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" class="history-view">
          <div class="history-hero">
            <div>
              <div class="history-kicker">{{ t('historyTitle') }}</div>
              <p>{{ t('historyHelp') }}</p>
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
            <div class="history-actions">
              <Button variant="secondary" size="sm" @click="exportHistory">{{ t('historyExport') }}</Button>
              <Button variant="danger" size="sm" @click="clearHistory">{{ t('historyClear') }}</Button>
            </div>
          </div>

          <div v-if="historyLoading && !historySummary" class="panel-empty">{{ t('checking') }}</div>
          <div v-else-if="historyError && !historySummary" class="panel-empty history-error">{{ historyError }}</div>
          <template v-else-if="historySummary">
            <div class="history-grid history-overview-grid">
              <Card :title="t('historyPetProgression')">
                <template v-if="progression">
                  <div class="history-level-row">
                    <strong>{{ t('historyLevel', { level: progression.level }) }}</strong>
                    <span>{{ evolutionLabel }}</span>
                  </div>
                  <ProgressTrack :value="progressionPercent" :aria-label="t('growth')" />
                  <div class="history-meta-row">
                    <span>{{ progression.xpIntoLevel }} / {{ progression.xpToNext }} XP</span>
                    <span>{{ moodStage }}</span>
                  </div>
                </template>
                <span v-else class="history-muted">{{ t('growthDataUnavailable') }}</span>
              </Card>
              <Card :title="t('historyStreakTitle')" tone="success">
                <strong>{{ t('historyStreak', { days: progression?.currentStreak ?? 0 }) }}</strong>
                <span class="history-muted">{{ t('historyLongestStreak', { days: progression?.longestStreak ?? 0 }) }}</span>
                <span class="history-muted">{{ t('historyRetention', { days: historySummary.retentionDays }) }}</span>
              </Card>
            </div>

            <Card :title="t('historyTokenTrend')" tone="accent">
              <template #heading>
                <span class="history-muted">{{ t('historyUpdated', { time: formatUpdated(new Date(historySummary.generatedAt).toISOString()) }) }}</span>
              </template>
              <div class="history-day-list">
                <div
                  v-for="day in historySummary.days"
                  :key="day.localDate"
                  class="history-day-row"
                  :title="`${day.sessionsCompleted}${t('historyCompleted')} · ${day.sessionsFailed}${t('historyFailed')}`"
                >
                  <span class="history-day-label">{{ historyDayLabel(day) }}</span>
                  <ProgressTrack
                    class="history-day-track"
                    :value="historyDayTokenPercent(day)"
                    tone="accent"
                    :aria-label="`${historyDayLabel(day)} ${historyDayTokenTotal(day)} tokens`"
                  />
                  <span class="history-day-count">{{ formatCompactNumber(historyDayTokenTotal(day)) }}</span>
                </div>
              </div>
            </Card>

            <div class="history-grid history-detail-grid">
              <Card :title="t('historySessions')" tone="success">
                <div class="history-stat-big">{{ historySummary.totals.sessionsCompleted + historySummary.totals.sessionsFailed }}</div>
                <div class="history-stat-row"><span>{{ t('historyCompleted') }}</span><strong>{{ historySummary.totals.sessionsCompleted }}</strong></div>
                <div class="history-stat-row"><span>{{ t('historyFailed') }}</span><strong>{{ historySummary.totals.sessionsFailed }}</strong></div>
                <div class="history-stat-row"><span>{{ t('historyActiveTime') }}</span><strong>{{ historyDuration(historySummary.totals.activeMs) }}</strong></div>
              </Card>
              <Card :title="t('historyTokens')" tone="accent">
                <div class="history-stat-big">{{ (historySummary.totals.tokenInput + historySummary.totals.tokenOutput).toLocaleString(locale) }}</div>
                <div class="history-token-quality">{{ historyTokenLabel(historySummary.tokenQuality) }}</div>
                <div class="history-muted">{{ historySummary.totals.tokenInput.toLocaleString(locale) }} in · {{ historySummary.totals.tokenOutput.toLocaleString(locale) }} out</div>
                <div class="history-tracking-note">
                  <span>{{ historyTrackingSinceLabel() }}</span>
                  <span class="history-tracking-explain">{{ t('historyTrackingExplain') }}</span>
                </div>
              </Card>
            </div>

            <Card :title="t('historyAgentDistribution')">
              <div v-if="historySummary.agents.length === 0" class="history-muted">{{ t('historyNoData') }}</div>
              <div v-else class="history-agent-list">
                <div v-for="agent in historySummary.agents" :key="agent.adapterId" class="history-agent-row">
                  <div class="history-agent-heading"><span>{{ historyAgentLabel(agent.adapterId) }}</span><strong>{{ historyAgentTokenTotal(agent).toLocaleString(locale) }}</strong></div>
                  <ProgressTrack :value="historyAgentBarPercent(agent)" decorative />
                  <div class="history-muted">{{ agent.tokenInput.toLocaleString(locale) }} {{ t('historyTokenIn') }} · {{ agent.tokenOutput.toLocaleString(locale) }} {{ t('historyTokenOut') }} · {{ historyTokenLabel(agent.tokenQuality) }}</div>
                  <div class="history-muted">{{ historyDuration(agent.activeMs) }} · {{ agent.sessionsCompleted }}✓ {{ agent.sessionsFailed }}!</div>
                </div>
              </div>
            </Card>

          </template>
          <div v-if="historyAction" class="history-action-status" role="status" aria-live="polite">{{ historyAction }}</div>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="settings-layout">
        <nav class="settings-nav" :aria-label="t('settingsSections')">
          <div class="settings-nav-heading">{{ t('preferences') }}</div>
          <button
            v-for="section in settingsSections"
            :key="section.id"
            class="settings-nav-item"
            :class="{ active: settingsTab === section.id }"
            role="tab"
            :aria-selected="settingsTab === section.id"
            @click="settingsTab = section.id"
          >
            <span class="settings-nav-icon" aria-hidden="true"><Icon :name="section.icon" :size="15" /></span>
            <span class="settings-nav-copy">
              <strong>{{ section.label }}</strong>
              <small>{{ section.hint }}</small>
            </span>
          </button>
        </nav>

        <div class="settings-content">
        <div class="settings-content-header">
          <span class="settings-kicker">{{ t('workspacePreferences') }}</span>
          <h2>{{ activeSettingsSection?.label }}</h2>
        </div>

        <template v-if="settingsTab === 'language'">
          <Card :title="t('languageSection')">
            <p class="section-copy">{{ t('languageHelp') }}</p>
            <div class="field-row">
              <span class="field-copy">
                <span class="field-label">{{ t('language') }}</span>
                <span class="field-help">{{ t('languageHint') }}</span>
              </span>
              <Select
                :model-value="locale"
                :aria-label="t('language')"
                class="field-control"
                @update:model-value="store.setLocalePreference($event as 'zh-TW' | 'en-US')"
              >
                <option value="zh-TW">{{ t('localeTraditionalChinese') }}</option>
                <option value="en-US">{{ t('localeEnglish') }}</option>
              </Select>
            </div>
          </Card>
        </template>

        <template v-else-if="settingsTab === 'appearance'">
          <Card :title="t('petSize')">
            <div class="scale-options" role="group" :aria-label="t('petSize')">
              <Button
                v-for="opt in scaleOptions"
                :key="opt.value"
                size="sm"
                variant="secondary"
                :active="store.petScale === opt.value"
                @click="store.setScale(opt.value)"
              >
                {{ opt.label }}
              </Button>
            </div>
          </Card>

          <Card :title="t('petReactions')">
            <ToggleRow
              :model-value="store.reactionsEnabled"
              :label="t('bounceShake')"
              :help="t('animateStatus')"
              @update:model-value="store.setReactionsEnabled($event)"
            />
            <ToggleRow
              :model-value="store.bubbleEnabled"
              :label="t('statusBubble')"
              :help="t('showCompletionError')"
              @update:model-value="store.setBubbleEnabled($event)"
            />
          </Card>
        </template>

        <template v-else-if="settingsTab === 'desktop'">
          <Card :title="t('windowModes')">
            <ToggleRow
              :model-value="store.petWindowMode.mode === 'mini'"
              :label="t('miniMode')"
              :help="t('miniModeHelp')"
              @update:model-value="store.setPetMode($event ? 'mini' : 'normal')"
            />
            <ToggleRow
              :model-value="store.edgeModeEnabled"
              :label="t('edgePeek')"
              :help="t('edgePeekHelp')"
              @update:model-value="store.setEdgeModeEnabled($event)"
            />
          </Card>

          <!-- Attention used to also carry Sound and Presentation MCP, which
               are not attention controls — they now sit in their own groups. -->
          <Card :title="t('attention')">
            <ToggleRow
              :model-value="store.dndEnabled"
              :label="t('dnd')"
              :help="t('dndHelp')"
              @update:model-value="store.setDndEnabled($event)"
            />
            <ToggleRow
              :model-value="store.notificationsEnabled"
              :label="t('notifications')"
              :help="t('notificationsHelp')"
              @update:model-value="store.setNotificationsEnabled($event)"
            />
            <ToggleRow
              :model-value="store.permissionBubbleEnabled"
              :label="t('permissionBubble')"
              :help="t('permissionBubbleHelp')"
              @update:model-value="store.setPermissionBubbleEnabled($event)"
            />
          </Card>

          <Card :title="t('sound')">
            <ToggleRow
              :model-value="store.soundEnabled"
              :label="t('sound')"
              :help="t('soundHelp')"
              @update:model-value="store.setSoundEnabled($event)"
            />
          </Card>

          <Card :title="t('system')">
            <ToggleRow
              :model-value="store.presentationMcpEnabled"
              :label="t('presentationMcp')"
              :help="t('presentationMcpHelp')"
              @update:model-value="store.setPresentationMcpEnabled($event)"
            />
            <ToggleRow
              :model-value="store.launchAtStartup"
              :label="t('launchAtStartup')"
              :help="store.launchAtStartupSupported ? t('launchAtStartupHelp') : t('availablePackaged')"
              :disabled="!store.launchAtStartupSupported"
              @update:model-value="store.setLaunchAtStartup($event)"
            />
          </Card>
        </template>

        <template v-else-if="settingsTab === 'growth'">
          <Card :title="t('petMood')">
            <template #heading>
              <Button size="sm" variant="secondary" :title="t('resetBaseline')" @click="store.resetMood()">
                {{ t('reset') }}
              </Button>
            </template>
            <div class="stat-row">
              <span class="stat-readout">{{ store.mood }} · {{ moodStage }}</span>
            </div>
            <ProgressTrack :value="store.mood" tone="success" :aria-label="t('petMood')" />
          </Card>

          <template v-if="progression">
            <Card :title="t('growth')" tone="accent">
              <template #heading>
                <span class="stat-readout">{{ progression.totalXp }} XP</span>
              </template>
              <div class="stat-row">
                <span class="stat-readout">Lv {{ progression.level }} · {{ evolutionLabel }}</span>
              </div>
              <ProgressTrack :value="progressionPercent" :aria-label="t('growth')" />
              <div class="stat-row muted">
                <span>{{ t('toNextLevel', { value: `${progression.xpIntoLevel} / ${progression.xpToNext}` }) }}</span>
                <span v-if="progression.currentStreak > 0">{{ t('dayStreak', { days: progression.currentStreak }) }}</span>
                <span v-else>{{ t('startStreak') }}</span>
              </div>
            </Card>
            <Card :title="t('moodVisuals')">
              <ToggleRow
                :model-value="store.moodVisualsEnabled"
                :label="t('moodVisuals')"
                :help="t('moodVisualsHelp')"
                @update:model-value="store.setMoodVisualsEnabled($event)"
              />
            </Card>
          </template>
          <div v-else class="growth-unavailable" role="status">
            {{ t('growthDataUnavailable') }}
          </div>
        </template>

        <template v-else-if="settingsTab === 'pets'">
          <Card :title="t('pets')">
            <div class="pet-list">
              <template v-for="pet in store.visiblePets" :key="pet.id">
                <input
                  v-if="editingPetId === pet.id"
                  v-model="editName"
                  class="pet-rename-input"
                  maxlength="64"
                  @keyup.enter="confirmRename"
                  @keyup.escape="cancelRename"
                  @blur="confirmRename"
                />
                <!-- Was a <div> with @click, unreachable by keyboard even
                     though picking a pet is the main action here. It can't
                     be a <button> either — the rename/remove actions inside
                     it are themselves buttons, and a button can't nest
                     inside a button (the browser would silently close the
                     outer tag early and break both the click target and the
                     nested actions). role="button" + explicit key handling
                     gets the same keyboard reachability without that trap. -->
                <div
                  v-else
                  class="pet-option"
                  :class="{ active: store.selectedPet === pet.id }"
                  role="button"
                  tabindex="0"
                  :aria-pressed="store.selectedPet === pet.id"
                  @click="store.setPet(pet.id)"
                  @keydown.enter="store.setPet(pet.id)"
                  @keydown.space.prevent="store.setPet(pet.id)"
                >
                  <span class="pet-name">{{ pet.displayName }}</span>
                  <span class="pet-actions">
                    <Button
                      v-if="!pet.builtIn"
                      variant="ghost"
                      size="sm"
                      :title="t('rename')"
                      :aria-label="t('rename')"
                      @click.stop="startRename(pet)"
                    >
                      <Icon name="edit" :size="13" />
                    </Button>
                    <Button
                      v-if="pet.id !== store.defaultPetId"
                      variant="ghost"
                      size="sm"
                      :title="pet.builtIn ? t('hide') : t('remove')"
                      :aria-label="pet.builtIn ? t('hide') : t('remove')"
                      @click.stop="confirmRemovePet(pet)"
                    >
                      <Icon name="close" :size="13" />
                    </Button>
                  </span>
                </div>
              </template>
            </div>
            <div class="import-row">
              <Button variant="primary" size="sm" :disabled="importing" @click="importPet">
                {{ importing ? t('importing') : t('importSprite') }}
              </Button>
              <Button variant="primary" size="sm" :disabled="importingZip" @click="importPetZip">
                {{ importingZip ? t('importing') : t('importZip') }}
              </Button>
            </div>
            <div v-if="importZipError" class="import-error">{{ importZipError }}</div>
          </Card>

          <Card :title="t('multiPet')">
            <ToggleRow
              :model-value="store.multiPetEnabled"
              :label="t('multiPet')"
              @update:model-value="store.setMultiPetEnabled($event)"
            />
          </Card>

          <Card v-if="store.multiPetEnabled" :title="t('perAgentPet')">
            <div class="field-row" v-for="family in SOURCE_FAMILIES" :key="family.key">
              <span class="family-pet-name">
                <span class="family-pet-dot" :class="`family-${family.key}`" />
                {{ family.label }}
              </span>
              <Select
                size="sm"
                class="field-control"
                :aria-label="family.label"
                :model-value="store.familyPetIds[family.key] || ''"
                @update:model-value="store.setFamilyPet(family.key, $event || null)"
              >
                <option value="">{{ t('defaultPet') }}</option>
                <option v-for="pet in store.visiblePets" :key="pet.id" :value="pet.id">
                  {{ pet.displayName }}
                </option>
              </Select>
            </div>
          </Card>

          <Card :title="t('projectPets')">
            <ToggleRow
              :model-value="store.projectPetsEnabled"
              :label="t('projectPetsEnable')"
              :help="t('projectPetsEnableHelp')"
              @update:model-value="store.setProjectPetsEnabled($event)"
            />
            <template v-if="store.projectPetsEnabled">
              <p class="section-copy">{{ t('projectPetsHelp') }}</p>
              <div class="project-pet-actions">
                <Button variant="secondary" size="sm" :disabled="store.projectPetsLoading" @click="store.addProjectPet()">
                  {{ store.projectPetsLoading ? t('checking') : t('addProjectPet') }}
                </Button>
              </div>
              <div v-if="store.projectPetsError" class="import-error" role="status">
                {{ store.projectPetsError }}
              </div>
              <div v-if="store.projectPetsLoading && store.projectPets.length === 0" class="project-pet-empty">
                {{ t('checking') }}
              </div>
              <div v-else-if="store.projectPets.length > 0" class="project-pet-list">
                <div v-for="project in store.projectPets" :key="project.projectId" class="project-pet-row">
                  <span class="field-copy">
                    <span class="field-label" :title="project.displayName">{{ project.displayName }}</span>
                    <span class="field-help" :class="{ 'project-pet-missing': project.bindingStatus === 'missing-pet' }">
                      {{ projectPetStatusLabel(project.bindingStatus) }}
                    </span>
                  </span>
                  <span class="project-pet-controls">
                    <Select
                      size="sm"
                      class="field-control"
                      :aria-label="`${project.displayName} ${t('projectPets')}`"
                      :model-value="project.boundPetId ?? ''"
                      @update:model-value="store.setProjectPetBinding(project.projectId, $event || null)"
                    >
                      <option value="">{{ t('useSelectedPet') }}</option>
                      <option v-if="project.bindingStatus === 'missing-pet' && project.boundPetId" :value="project.boundPetId">
                        {{ t('missingPet') }}
                      </option>
                      <option v-for="pet in store.visiblePets" :key="pet.id" :value="pet.id">
                        {{ pet.displayName }}
                      </option>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      :title="t('remove')"
                      :aria-label="`${t('remove')} ${project.displayName}`"
                      @click="confirmRemoveProjectPet(project)"
                    >
                      <Icon name="close" :size="13" />
                    </Button>
                  </span>
                </div>
              </div>
              <div v-else class="project-pet-empty">
                {{ t('projectPetsNoProjects') }}
              </div>
            </template>
          </Card>
        </template>

        <template v-else>
          <Card :title="t('presentationMcpSection')">
            <p class="section-copy">{{ t('presentationMcpSetupHelp') }}</p>
            <Button variant="primary" size="sm" block @click="store.openProjectMcpPanel">
              {{ t('projectMcpPanelTitle') }}
            </Button>
          </Card>
          <Card :title="t('keepControl')">
            <p class="section-copy">{{ t('keepControlHelp') }}</p>
            <div class="advanced-actions">
              <Button variant="primary" size="sm" block @click="store.showWizard = true">{{ t('setupWizard') }}</Button>
              <Button variant="secondary" size="sm" block @click="restartApp">{{ t('restartPet') }}</Button>
              <Button variant="danger" size="sm" block @click="quitApp">{{ t('quit') }}</Button>
            </div>
          </Card>
        </template>
      </div>
      </div>
    </template>

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
/* Everything here reads from src/styles/tokens.css. No bare hex or rgba():
   a literal colour in this file is a bug, because it cannot be themed or
   audited. Buttons, cards, toggles, progress bars, selects and icons all
   come from components/ui/ — do not re-style them locally. */

.status-panel {
  position: relative;
  width: 100%;
  height: 100%;
  /* A dark solid layer sits underneath the sheen/tint so text stays legible
     no matter what's behind the window (bright desktop wallpaper, video,
     etc.) — the glass look comes from the blur + highlight, not from
     letting the backdrop show through at full strength. */
  background: var(--surface-panel);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-md);
  text-shadow: var(--text-shadow-panel);
  overflow: hidden;
  backdrop-filter: var(--surface-blur);
  -webkit-backdrop-filter: var(--surface-blur);
  box-shadow: var(--shadow-panel);
  z-index: 9999;
  display: flex;
  flex-direction: column;
}

/* ── Header ──────────────────────────────────────────────────────────── */

.panel-header {
  position: relative;
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.panel-title {
  flex: 1;
  font-size: var(--font-md);
  font-weight: var(--weight-medium);
}

.header-right {
  display: flex;
  gap: var(--space-1);
}

.panel-empty {
  padding: var(--space-5) var(--space-3);
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

/* ── Dashboard tabs ──────────────────────────────────────────────────── */

.dashboard-tabs {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3) var(--space-1);
}

.dashboard-tab {
  padding: 5px var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.dashboard-tab:hover {
  color: var(--text-primary);
  background: var(--surface-raised-hover);
  border-color: var(--border-strong);
}

.dashboard-tab.active {
  color: var(--accent-bright);
  background: var(--accent-soft);
  border-color: var(--border-accent-strong);
}

.dashboard-tab:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.tab-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

/* ── Sessions ────────────────────────────────────────────────────────── */

.session-list {
  min-height: 0;
  flex: 1;
  padding: var(--space-2);
  overflow-y: auto;
}

.session-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px var(--space-2);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.session-item:hover {
  background: var(--surface-raised);
}

.session-source {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.session-info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.state-chip {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 5px;
  padding: 2px var(--space-2);
  border: 1px solid;
  border-radius: var(--radius-pill);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.state-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
}

.state-chip.live .state-dot {
  animation: state-pulse 1.4s ease-in-out infinite;
}

@keyframes state-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.state-elapsed {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.session-project {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}

.session-footer {
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  padding: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

/* ── Usage ───────────────────────────────────────────────────────────── */

.usage-view {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3) var(--space-3);
  overflow-y: auto;
}

.usage-loading {
  animation: usage-pulse 1.2s ease-in-out infinite;
}

@keyframes usage-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.usage-error,
.usage-provider-error {
  color: var(--state-error-soft);
}

.quota-copy,
.usage-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.usage-provider-name {
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.usage-plan {
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  background: var(--surface-raised-hover);
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.usage-provider-error {
  padding-top: var(--space-2);
  font-size: var(--font-xs);
  line-height: 1.45;
}

.quota-window-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.quota-label {
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.quota-value {
  color: var(--text-bright);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.quota-progress {
  margin-top: var(--space-1);
}

.quota-reset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.quota-reset-at {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.usage-footer {
  padding: var(--space-2) 2px 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

/* ── History ─────────────────────────────────────────────────────────── */

.history-view {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
  overflow-y: auto;
}

.history-hero,
.history-level-row,
.history-meta-row,
.history-agent-heading,
.history-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.history-hero {
  flex-wrap: wrap;
  padding: var(--space-1) 2px;
}

.history-kicker {
  color: var(--text-primary);
  font-size: var(--font-md);
  font-weight: var(--weight-bold);
}

.history-hero p {
  max-width: 230px;
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.history-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
}

.history-project-filter {
  flex: 0 1 150px;
  margin-left: auto;
}

.history-grid {
  display: grid;
  gap: var(--space-2);
  grid-template-columns: 1fr 1fr;
}

.history-muted {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.history-error {
  color: var(--state-error-soft);
}

.history-level-row,
.history-meta-row,
.history-stat-row,
.history-agent-heading {
  font-size: var(--font-xs);
}

.history-stat-big {
  color: var(--text-bright);
  font-size: var(--font-xl);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.history-token-quality {
  color: var(--state-info);
  font-size: var(--font-xs);
}

.history-tracking-note {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: var(--space-1);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.history-tracking-note > :first-child {
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

.history-tracking-explain {
  line-height: 1.5;
}

.history-day-list,
.history-agent-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.history-day-row {
  display: grid;
  align-items: center;
  gap: var(--space-2);
  /* Was 52px for the date label, which "Wed 8/13"-style formatting (weekday
     + numeric date) overflows in both locales — it wrapped to two lines and
     staggered every row under it. The label is now numeric-only ("8/13")
     and both text columns are nowrap + a fixed min width so the row can
     never wrap regardless of locale or content length. */
  grid-template-columns: minmax(34px, auto) 1fr minmax(48px, auto);
  font-size: var(--font-xs);
}

.history-day-label,
.history-day-count {
  white-space: nowrap;
}

.history-day-label {
  color: var(--text-secondary);
}

.history-day-count {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.history-agent-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.history-action-status {
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  text-align: center;
}

/* ── Settings ────────────────────────────────────────────────────────── */

.settings-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

.settings-nav {
  display: flex;
  width: 132px;
  flex: 0 0 132px;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-2);
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  overflow-y: auto;
}

.settings-nav-heading {
  padding: 0 7px var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 40px;
  gap: var(--space-2);
  padding: var(--space-1) 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.settings-nav-item:hover {
  color: var(--text-primary);
  background: var(--surface-raised);
}

.settings-nav-item.active {
  color: var(--accent-bright);
  border-color: var(--border-accent-strong);
  background: var(--accent-soft);
}

.settings-nav-item:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.settings-nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: inherit;
}

.settings-nav-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.settings-nav-copy strong {
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.settings-nav-copy small {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.settings-content {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  overflow-y: auto;
}

.settings-content-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-kicker {
  color: var(--text-muted);
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.settings-content-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-lg);
  font-weight: var(--weight-medium);
}

.section-copy {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.5;
}

/* A labelled control sitting on one row — the settings equivalent of
   ToggleRow, for anything that is not a switch. */
.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.field-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.field-label {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-help {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-control {
  flex: 0 0 auto;
  min-width: 128px;
}

.project-pet-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.project-pet-list {
  display: flex;
  max-height: 220px;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-2);
  overflow-y: auto;
}

.project-pet-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
}

/* The remove button eats into the row's width budget that .field-control's
   128px assumes elsewhere (a lone select); narrow it here so long project
   names still get enough room to read before ellipsis kicks in. */
.project-pet-controls .field-control {
  min-width: 108px;
}

.project-pet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-top: 1px solid var(--border-subtle);
}

.project-pet-missing {
  color: var(--accent-claude);
}

.project-pet-empty {
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.scale-options {
  display: flex;
  gap: var(--space-1);
}

.scale-options > * {
  flex: 1;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--font-xs);
}

.stat-row.muted {
  color: var(--text-muted);
}

.stat-readout {
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}

.growth-unavailable {
  padding: var(--space-4);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-align: center;
}

/* ── Pets ────────────────────────────────────────────────────────────── */

.pet-list {
  display: flex;
  max-height: 168px;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.pet-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-sm);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.pet-option:hover {
  background: var(--surface-raised);
  color: var(--text-primary);
}

.pet-option.active {
  border-color: var(--border-accent-strong);
  background: var(--accent-soft);
  color: var(--accent-bright);
}

.pet-option:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.pet-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}

.pet-rename-input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-accent-strong);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--surface-raised-hover);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-sm);
}

.import-row {
  display: flex;
  gap: var(--space-2);
}

.import-row > * {
  flex: 1;
}

.import-error {
  color: var(--state-error-soft);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.family-pet-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.family-pet-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  box-shadow: 0 0 6px currentColor;
}

/* Applied dynamically as `family-${family.key}`. */
.family-pet-dot.family-codex {
  color: var(--accent);
  background: var(--accent);
}

.family-pet-dot.family-claude {
  color: var(--accent-claude);
  background: var(--accent-claude);
}

.family-pet-dot.family-opencode {
  color: var(--state-success);
  background: var(--state-success);
}

/* ── Advanced ────────────────────────────────────────────────────────── */

.advanced-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* ── Narrow panel ────────────────────────────────────────────────────
   The panel can be resized down by the user; below this the two-column
   history grid and the settings sidebar stop being readable. */
@media (max-width: 420px) {
  .history-grid {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    width: 112px;
    flex-basis: 112px;
  }

  .settings-nav-copy small {
    display: none;
  }
}
</style>
