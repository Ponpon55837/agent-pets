<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t } from '@/i18n'
import type { PluginEventSourceStatusView } from '@/types/plugin'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import InlinePermissionCard from '@/components/ui/InlinePermissionCard.vue'
import PermissionOutcomeNotice from '@/components/permission/PermissionOutcomeNotice.vue'
import PetAnimation from '@/components/PetAnimation.vue'
import ServerHealthBanner from '@/components/status-panel/ServerHealthBanner.vue'
import StatusPanelHistory from '@/components/status-panel/StatusPanelHistory.vue'
import StatusPanelSessions from '@/components/status-panel/StatusPanelSessions.vue'
import StatusPanelUsage from '@/components/status-panel/StatusPanelUsage.vue'
import { countByBucket } from '@/utils/session-view'
import { DEFAULT_SETTINGS_GROUP, SETTINGS_GROUPS, isSettingsGroupId, type SettingsGroupId } from '@/utils/settingsRegistry'

const store = useAgentStore()
const panelRoot = ref<HTMLElement | null>(null)
const settingsShortcut = /Mac/i.test(navigator.platform) ? '\u2318,' : 'Ctrl+,'

type DashboardTab = 'sessions' | 'usage' | 'history'

const SETTINGS_GROUP_STORAGE_KEY = 'agent-pets-settings-group'

function readStoredSettingsGroup(): SettingsGroupId {
  try {
    const stored = localStorage.getItem(SETTINGS_GROUP_STORAGE_KEY)
    if (isSettingsGroupId(stored)) return stored
  } catch {}
  return DEFAULT_SETTINGS_GROUP
}

// The last-used group is remembered across panel opens.
const settingsGroup = ref<SettingsGroupId>(readStoredSettingsGroup())
const dashboardTab = ref<DashboardTab>('sessions')
// Usage and History mount on first visit, then stay mounted so their state survives tab switches.
const visitedTabs = ref(new Set<DashboardTab>(['sessions']))
const requestedPluginViewId = ref('')
const pluginEventSourceStatuses = ref<PluginEventSourceStatusView[]>([])
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
let removePluginViewRequestListener: (() => void) | null = null
let removePanelSettingsListener: (() => void) | null = null
let cleanupPluginEventSourceChanged: (() => void) | null = null

const SettingsPage = defineAsyncComponent(() => import('@/components/status-panel/SettingsPage.vue'))

const settingsGroupLabel = computed(() => {
  const group = SETTINGS_GROUPS.find(item => item.id === settingsGroup.value)
  return group ? t(group.labelKey) : ''
})
const dashboardTabs = computed(() => [
  { value: 'sessions', label: t('sessions'), badge: attentionCount.value },
  { value: 'usage', label: t('tokenRemaining') },
  { value: 'history', label: t('history') },
])
const attentionCount = computed(() => countByBucket(store.sessionList).attention)
const activePetName = computed(() => store.pets.find(pet => pet.id === store.activePetId)?.displayName ?? t('appName'))
const evolutionLabels: Record<string, Parameters<typeof t>[0]> = {
  egg: 'evolutionEgg', baby: 'evolutionBaby', teen: 'evolutionTeen', adult: 'evolutionAdult', master: 'evolutionMaster',
}
// Give up on "loading" after a while so the header never spins forever.
const progressionTimedOut = ref(false)
let progressionTimeout: ReturnType<typeof setTimeout> | null = null
const sessionCounts = computed(() => countByBucket(store.sessionList))
const panelPetSubtitle = computed(() => {
  const { running, attention } = sessionCounts.value
  if (running + attention > 0) return t('panel.subtitleActive', { running, attention })
  if (!store.progression) return progressionTimedOut.value ? t('panel.progressUnavailable') : t('petProgressLoading')
  return `${t('historyLevel', { level: store.progression.level })} · ${t(evolutionLabels[store.progression.evolutionStage])} · ${t('dayStreak', { days: store.progression.currentStreak })}`
})

// The shared clock only needs to be precise while the permission card shows
// its running seconds; Usage reset labels are minute-granular. Sessions have
// their own per-label clock (useNow), so idle panels barely wake the renderer.
const TICK_FAST_MS = 1000
const TICK_SLOW_MS = 30_000
const tickInterval = computed(() => store.permissionRequest ? TICK_FAST_MS : TICK_SLOW_MS)
let tickTimerMs = 0

function syncTickTimer(): void {
  if (document.hidden) {
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
    tickTimerMs = 0
    return
  }
  if (tickTimer && tickTimerMs === tickInterval.value) return
  if (tickTimer) clearInterval(tickTimer)
  nowTick.value = Date.now()
  tickTimerMs = tickInterval.value
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, tickTimerMs)
}

watch(tickInterval, syncTickTimer)

// Esc steps back one level: wizard / MCP, then settings, then hide the panel.
// Anything that already handled the key (ConfirmDialog, inputs) wins.
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if ((event.metaKey || event.ctrlKey) && event.key === ',') {
    event.preventDefault()
    if (store.panelView !== 'settings') store.openSettings()
    return
  }
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (store.showWizard) store.closeSetupWizard()
  else if (store.showProjectMcpPanel) store.closeProjectMcpPanel()
  else if (store.panelView === 'settings') store.backToSessions()
  else store.closePanel()
}

function openPetSettings(): void {
  settingsGroup.value = 'pets'
  store.openSettings()
}

function openPluginSettings(): void {
  settingsGroup.value = 'integrations'
  store.openSettings()
}

function selectDashboardTab(tab: DashboardTab): void {
  dashboardTab.value = tab
  visitedTabs.value.add(tab)
  if ((tab === 'sessions' || tab === 'usage') && !store.quotaUsage) void store.refreshQuota()
}

// Move keyboard focus into the panel whenever it is (re)opened so Tab / arrows work immediately.
watch(() => store.panelOpenCount, async () => {
  await nextTick()
  const target = store.panelView === 'settings'
    ? panelRoot.value?.querySelector<HTMLElement>('.panel-header button')
    : document.getElementById(`tab-${dashboardTab.value}`)
  target?.focus({ preventScroll: true })
})

watch(settingsGroup, group => {
  try { localStorage.setItem(SETTINGS_GROUP_STORAGE_KEY, group) } catch {}
})

onMounted(() => {
  // Keep the settings panels code-split while warming the default tab off the
  // render path, so the first settings click does not wait for its chunk.
  void import('@/components/status-panel/SettingsPage.vue').catch(() => {})
  progressionTimeout = setTimeout(() => { progressionTimedOut.value = true }, 8000)
  document.addEventListener('visibilitychange', syncTickTimer)
  window.addEventListener('keydown', onGlobalKeydown)
  syncTickTimer()
  removePanelSettingsListener = window.electronAPI?.onPanelOpenSettings(() => {
    requestedPluginViewId.value = ''
  }) ?? null
  removePluginViewRequestListener = window.electronAPI?.onPanelOpenPluginView(pluginId => {
    settingsGroup.value = 'integrations'
    requestedPluginViewId.value = ''
    void nextTick(() => { requestedPluginViewId.value = pluginId })
  }) ?? null
  store.loadPets()
  void store.refreshProjectPets()
  void store.refreshQuota()
  if (window.electronAPI?.onPluginEventSourceChanged) {
    cleanupPluginEventSourceChanged = window.electronAPI.onPluginEventSourceChanged(statuses => {
      pluginEventSourceStatuses.value = statuses
    })
  }
  void window.electronAPI?.getPluginEventSourceStatuses().then(statuses => {
    pluginEventSourceStatuses.value = statuses
  }).catch(() => {})
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', syncTickTimer)
  window.removeEventListener('keydown', onGlobalKeydown)
  if (progressionTimeout) clearTimeout(progressionTimeout)
  if (tickTimer) clearInterval(tickTimer)
  removePluginViewRequestListener?.()
  removePanelSettingsListener?.()
  cleanupPluginEventSourceChanged?.()
})
</script>

<template>
  <div ref="panelRoot" class="status-panel" :inert="store.showWizard || store.showProjectMcpPanel" @click.stop>
    <div class="panel-header">
      <Button v-if="store.panelView === 'settings'" variant="ghost" icon-only :title="t('back')" :aria-label="t('back')" @click="store.backToSessions()">
        <Icon name="back" />
      </Button>
      <template v-if="store.panelView === 'sessions'">
        <button type="button" class="panel-pet-avatar" :title="t('panel.changePet')" :aria-label="t('panel.changePet')" @click="openPetSettings">
          <PetAnimation class="panel-pet-animation" aria-hidden="true" :state="store.currentState" :pet-id="store.activePetId" :since="store.highestPrioritySession?.lastSeenAt" :mood="store.mood" />
        </button>
        <div class="panel-title-group">
          <span class="panel-title">{{ activePetName }}</span>
          <span class="panel-subtitle">{{ panelPetSubtitle }}</span>
        </div>
      </template>
      <h1 v-else class="panel-title settings-panel-title">
        {{ t('settings') }}<Icon class="breadcrumb-sep" name="chevron-right" :size="12" /><span class="breadcrumb-current">{{ settingsGroupLabel }}</span>
      </h1>
      <div class="header-right">
        <Button v-if="store.panelView === 'sessions'" variant="ghost" icon-only :title="`${t('settings')} (${settingsShortcut})`" :aria-label="t('settings')" @click="store.openSettings()">
          <Icon name="settings" />
        </Button>
        <Button v-if="store.panelView === 'sessions'" variant="ghost" icon-only :active="store.dndEnabled" :title="`${t('dnd')}: ${store.dndEnabled ? t('panel.stateOn') : t('panel.stateOff')}`" :aria-label="t('dnd')" @click="store.setDndEnabled(!store.dndEnabled)">
          <Icon name="moon" />
        </Button>
        <Button v-if="store.panelView === 'sessions'" variant="ghost" icon-only :active="store.panelPinned" :title="store.panelPinned ? t('panel.unpin') : t('panel.pin')" :aria-label="store.panelPinned ? t('panel.unpin') : t('panel.pin')" :aria-pressed="store.panelPinned" @click="store.setPanelPinned(!store.panelPinned)">
          <Icon name="pin" />
        </Button>
        <Button variant="ghost" icon-only :title="`${t('close')} (Esc)`" :aria-label="t('close')" @click="store.closePanel()">
          <Icon name="close" />
        </Button>
      </div>
    </div>

    <template v-if="store.panelView === 'sessions'">
      <ServerHealthBanner />
      <InlinePermissionCard
        v-if="store.permissionRequest"
        class="panel-inline-permission"
        :request="store.permissionRequest"
        @decide="store.decidePermission(store.permissionRequest.requestId, $event)"
      />
      <PermissionOutcomeNotice v-else-if="store.permissionOutcome" />
      <div v-else-if="store.permissionNotice" class="inline-permission-notice" role="status">
        <Icon name="warning" :size="18" />
        <span><strong>{{ store.permissionNotice.title }}</strong><small>{{ store.permissionNotice.detail }}</small></span>
      </div>
      <div class="dashboard-nav">
        <SegmentedControl
          :model-value="dashboardTab"
          :options="dashboardTabs"
          :ariaLabel="t('dashboardSections')"
          id-prefix="tab-"
          panel-id-prefix="panel-"
          @update:model-value="selectDashboardTab($event as DashboardTab)"
        />
      </div>
      <StatusPanelSessions v-show="dashboardTab === 'sessions'" :active="dashboardTab === 'sessions'" :now-tick="nowTick" :plugin-event-source-statuses="pluginEventSourceStatuses" @manage-plugins="openPluginSettings" />
      <StatusPanelUsage v-if="visitedTabs.has('usage')" v-show="dashboardTab === 'usage'" :now-tick="nowTick" />
      <StatusPanelHistory v-if="visitedTabs.has('history')" v-show="dashboardTab === 'history'" :active="dashboardTab === 'history'" />
    </template>

    <SettingsPage v-else v-model:group="settingsGroup" :requested-plugin-id="requestedPluginViewId" />
  </div>
</template>

<style scoped src="@/components/StatusPanel.css"></style>
