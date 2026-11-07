<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ActionMenu from '@/components/ui/ActionMenu.vue'
import SegmentedTabs from '@/components/ui/SegmentedTabs.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import PluginAdvanced from '@/components/plugin-panel/PluginAdvanced.vue'
import PluginCatalog from '@/components/plugin-panel/PluginCatalog.vue'
import PluginInstalledList from '@/components/plugin-panel/PluginInstalledList.vue'
import PluginNotificationInbox from '@/components/plugin-panel/PluginNotificationInbox.vue'
import PluginPanelDialogs from '@/components/plugin-panel/PluginPanelDialogs.vue'
import PluginPanelFrame from '@/components/plugin-panel/PluginPanelFrame.vue'
import { PLUGIN_PANEL_CONTROLLER } from '@/composables/plugin/context'
import { usePluginPanelController } from '@/composables/usePluginPanelController'

const props = defineProps<{ requestedPluginId?: string }>()
const controller = usePluginPanelController(props)
provide(PLUGIN_PANEL_CONTROLLER, controller)
const {
  snapshot, notifications, plugins, catalogItems, busy, loading, errorMessage, statusMessage,
  panelViewPlugin, panelViewFrame, panelViewContent, pendingPlan, pendingRemove, pendingSecretConsentKey,
  keepData, enabledGlobally, pendingPluginName, pendingPermissions, pendingAddedPermissions,
  displayFingerprint, planKindLabel, pluginName, refreshPanel, selectArchive, selectDeveloperFolder,
  updateGlobalPreferences, confirmInstall, confirmRemove, confirmSecretConsent,
} = controller

type PluginTab = 'installed' | 'explore' | 'notifications' | 'advanced'
const activeTab = ref<PluginTab>('installed')

const enabledCount = computed(() => plugins.value.filter(plugin => plugin.preference.enabled).length)
const updateCount = computed(() => catalogItems.value.filter(item => item.updateAvailable).length)
const unreadCount = computed(() => notifications.value.filter(record => !record.read).length)
const developerMode = computed(() => snapshot.value?.preferences.developerMode ?? false)
const tabs = computed(() => [
  { id: 'installed', label: t('plugins.tabInstalled'), badge: plugins.value.length },
  { id: 'explore', label: t('plugins.tabExplore'), badge: updateCount.value },
  { id: 'notifications', label: t('plugins.tabNotifications'), badge: unreadCount.value },
  { id: 'advanced', label: t('plugins.tabAdvanced') },
])
const installMenuItems = computed(() => [
  { id: 'archive', label: t('plugins.installFromFile') },
  { id: 'folder', label: t('pluginDeveloperLoadFolder') },
])

function onInstallMenu(id: string): void {
  if (id === 'folder') void selectDeveloperFolder()
  else void selectArchive()
}

function showTab(tab: PluginTab): void {
  activeTab.value = tab
}
</script>

<template>
  <PluginPanelFrame
    v-if="panelViewPlugin"
    @frame="panelViewFrame = $event"
    @content="panelViewContent = $event"
  />

  <div v-else class="plugin-panel">
    <header class="plugin-header">
      <div class="plugin-header-copy">
        <h2>{{ t('plugins') }}</h2>
        <p class="plugin-summary">
          <Button variant="ghost" size="sm" @click="showTab('installed')">
            {{ t('plugins.summaryEnabled', { enabled: enabledCount, total: plugins.length }) }}
          </Button>
          <Button v-if="updateCount" variant="ghost" size="sm" @click="showTab('explore')">
            {{ t('plugins.summaryUpdates', { count: updateCount }) }}
          </Button>
          <Button v-if="unreadCount" variant="ghost" size="sm" @click="showTab('notifications')">
            {{ t('plugins.summaryUnread', { count: unreadCount }) }}
          </Button>
        </p>
      </div>
      <div class="plugin-header-actions">
        <ActionMenu
          v-if="developerMode"
          :items="installMenuItems"
          :aria-label="t('pluginInstallButton')"
          variant="primary"
          size="sm"
          :disabled="busy"
          @select="onInstallMenu"
        >
          {{ t('pluginInstallButton') }}
        </ActionMenu>
        <Button v-else variant="primary" size="sm" :disabled="busy" @click="selectArchive">
          {{ t('pluginInstallButton') }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="loading || busy" @click="refreshPanel">
          {{ loading ? t('checking') : t('refresh') }}
        </Button>
      </div>
    </header>

    <Card class="plugin-global" :class="{ off: !enabledGlobally }">
      <ToggleRow
        :model-value="enabledGlobally"
        :label="t('pluginGlobalEnabled')"
        :help="enabledGlobally ? t('pluginGlobalEnabledHelp') : t('plugins.globalOffBanner')"
        :disabled="busy"
        @update:model-value="updateGlobalPreferences({ pluginsEnabled: $event })"
      />
    </Card>

    <div v-if="errorMessage" class="error-msg plugin-message" role="alert">{{ errorMessage }}</div>
    <div v-if="statusMessage" class="plugin-message plugin-success" role="status" aria-live="polite">{{ statusMessage }}</div>

    <SegmentedTabs v-model="activeTab" :tabs="tabs" :aria-label="t('plugins.tabsLabel')" id-prefix="plugin" />

    <div
      v-show="activeTab === 'installed'"
      id="plugin-panel-installed"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-installed"
    >
      <PluginInstalledList />
    </div>
    <div
      v-show="activeTab === 'explore'"
      id="plugin-panel-explore"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-explore"
    >
      <PluginCatalog />
    </div>
    <div
      v-show="activeTab === 'notifications'"
      id="plugin-panel-notifications"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-notifications"
    >
      <PluginNotificationInbox />
    </div>
    <div
      v-show="activeTab === 'advanced'"
      id="plugin-panel-advanced"
      class="plugin-tab-panel"
      role="tabpanel"
      aria-labelledby="plugin-tab-advanced"
    >
      <PluginAdvanced />
    </div>

    <PluginPanelDialogs
      :plan="pendingPlan"
      :pending-plugin-name="pendingPluginName"
      :pending-permissions="pendingPermissions"
      :pending-added-permissions="pendingAddedPermissions"
      :remove-name="pendingRemove ? pluginName(pendingRemove) : ''"
      :keep-data="keepData"
      :secret-consent-open="pendingSecretConsentKey !== ''"
      :display-fingerprint="displayFingerprint"
      :plan-kind-label="planKindLabel"
      @confirm-install="confirmInstall"
      @cancel-install="pendingPlan = null"
      @confirm-remove="confirmRemove"
      @cancel-remove="pendingRemove = null"
      @update-keep-data="keepData = $event"
      @confirm-secret-consent="confirmSecretConsent"
      @cancel-secret-consent="pendingSecretConsentKey = ''"
    />
  </div>
</template>

<style scoped src="./PluginPanel.css"></style>
