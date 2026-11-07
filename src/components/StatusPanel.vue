<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t } from '@/i18n'
import type { PluginEventSourceStatusView } from '@/types/plugin'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import InlinePermissionCard from '@/components/ui/InlinePermissionCard.vue'
import PermissionOutcomeNotice from '@/components/permission/PermissionOutcomeNotice.vue'
import PetAnimation from '@/components/PetAnimation.vue'
import ServerHealthBanner from '@/components/status-panel/ServerHealthBanner.vue'
import StatusPanelHistory from '@/components/status-panel/StatusPanelHistory.vue'
import StatusPanelSessions from '@/components/status-panel/StatusPanelSessions.vue'
import StatusPanelUsage from '@/components/status-panel/StatusPanelUsage.vue'
import { DEFAULT_SETTINGS_GROUP, SETTINGS_GROUPS, isSettingsGroupId, type SettingsGroupId } from '@/utils/settingsRegistry'

const store = useAgentStore()
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
const dashboardTabs = computed<Array<{ id: DashboardTab; label: string }>>(() => [
  { id: 'sessions', label: t('sessions') },
  { id: 'usage', label: t('tokenRemaining') },
  { id: 'history', label: t('history') },
])
const activePetName = computed(() => store.pets.find(pet => pet.id === store.activePetId)?.displayName ?? t('appName'))
const evolutionLabels: Record<string, Parameters<typeof t>[0]> = {
  egg: 'evolutionEgg', baby: 'evolutionBaby', teen: 'evolutionTeen', adult: 'evolutionAdult', master: 'evolutionMaster',
}
const panelPetSubtitle = computed(() => {
  if (!store.progression) return t('petProgressLoading')
  return `${t('historyLevel', { level: store.progression.level })} · ${t(evolutionLabels[store.progression.evolutionStage])} · ${t('dayStreak', { days: store.progression.currentStreak })}`
})

function syncTickTimer(): void {
  if (document.hidden) {
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
    return
  }
  if (!tickTimer) tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
}

function onTabKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const ids = dashboardTabs.value.map(tab => tab.id)
  const next = ids[(ids.indexOf(dashboardTab.value) + step + ids.length) % ids.length]
  selectDashboardTab(next)
  document.getElementById(`tab-${next}`)?.focus()
}

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

function selectDashboardTab(tab: DashboardTab): void {
  dashboardTab.value = tab
  if ((tab === 'sessions' || tab === 'usage') && !store.quotaUsage) void store.refreshQuota()
}

function permissionSourceLabel(agentId: string): string {
  return SOURCE_LABELS[agentId as keyof typeof SOURCE_LABELS] ?? agentId
}

watch(settingsGroup, group => {
  try { localStorage.setItem(SETTINGS_GROUP_STORAGE_KEY, group) } catch {}
})

onMounted(() => {
  // Keep the settings panels code-split while warming the default tab off the
  // render path, so the first settings click does not wait for its chunk.
  void import('@/components/status-panel/SettingsPage.vue').catch(() => {})
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
  if (tickTimer) clearInterval(tickTimer)
  removePluginViewRequestListener?.()
  removePanelSettingsListener?.()
  cleanupPluginEventSourceChanged?.()
})
</script>

<template>
  <div class="status-panel" @click.stop>
    <div class="panel-header">
      <Button v-if="store.panelView === 'settings'" variant="ghost" icon-only :title="t('back')" :aria-label="t('back')" @click="store.backToSessions()">
        <Icon name="back" />
      </Button>
      <template v-if="store.panelView === 'sessions'">
        <div class="panel-pet-avatar" aria-hidden="true">
          <PetAnimation class="panel-pet-animation" :state="store.currentState" :pet-id="store.activePetId" :since="store.highestPrioritySession?.lastSeenAt" :mood="store.mood" />
        </div>
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
      <div class="dashboard-tabs" role="tablist" :aria-label="t('dashboardSections')">
        <Button
          v-for="tab in dashboardTabs"
          :key="tab.id"
          variant="ghost"
          size="sm"
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
        </Button>
      </div>
      <StatusPanelSessions v-show="dashboardTab === 'sessions'" :active="dashboardTab === 'sessions'" :now-tick="nowTick" :plugin-event-source-statuses="pluginEventSourceStatuses" />
      <StatusPanelUsage v-show="dashboardTab === 'usage'" :now-tick="nowTick" />
      <StatusPanelHistory v-show="dashboardTab === 'history'" :active="dashboardTab === 'history'" />
    </template>

    <SettingsPage v-else v-model:group="settingsGroup" :requested-plugin-id="requestedPluginViewId" />
  </div>
</template>

<style scoped src="@/components/StatusPanel.css"></style>
