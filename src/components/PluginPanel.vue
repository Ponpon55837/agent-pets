<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import type {
  PluginBrokerDiagnostic,
  PluginBrokerLogEntry,
  PluginInstallPlan,
  PluginNotificationRecord,
  PluginPanelPlugin,
  PluginPanelSnapshot,
  PluginPreferences,
} from '@/types/plugin'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const snapshot = ref<PluginPanelSnapshot | null>(null)
const notifications = ref<PluginNotificationRecord[]>([])
const logs = ref<PluginBrokerLogEntry[]>([])
const diagnostics = ref<PluginBrokerDiagnostic[]>([])
const selectedPluginId = ref('')
const busy = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const pendingPlan = ref<PluginInstallPlan | null>(null)
const pendingRemove = ref<PluginPanelPlugin | null>(null)
const keepData = ref(false)
let removeNotificationsListener: (() => void) | null = null

const plugins = computed(() => snapshot.value?.plugins ?? [])
const enabledGlobally = computed(() => snapshot.value?.preferences.pluginsEnabled ?? false)
const hasCompatiblePlan = computed(() => Boolean(pendingPlan.value && pendingPlan.value.kind !== 'incompatible'))
const pendingPluginName = computed(() => pendingPlan.value?.name?.[locale.value] ?? pendingPlan.value?.pluginId ?? '')

function pluginName(plugin: PluginPanelPlugin): string {
  return plugin.manifest?.name[locale.value] ?? plugin.id
}

function pluginIconUrl(plugin: PluginPanelPlugin): string | null {
  const icon = plugin.manifest?.icon
  if (!icon) return null
  return `agent-pets://plugin/${plugin.id}/${icon.split('/').map(encodeURIComponent).join('/')}`
}

function pluginStatusLabel(plugin: PluginPanelPlugin): string {
  if (plugin.status === 'disabled_crashed') return t('pluginStatusCrashed')
  if (plugin.status === 'incompatible' || !plugin.manifest) return t('pluginStatusIncompatible')
  if (!plugin.preference.enabled || !enabledGlobally.value) return t('pluginStatusDisabled')
  return t('pluginStatusEnabled')
}

function pluginStatusTone(plugin: PluginPanelPlugin): 'success' | 'warn' | 'neutral' {
  if (plugin.status === 'disabled_crashed' || plugin.status === 'incompatible' || !plugin.manifest) return 'warn'
  return plugin.preference.enabled && enabledGlobally.value ? 'success' : 'neutral'
}

function localizedError(code: string): string {
  const keys: Record<string, TranslationKey> = {
    preferences_unsafe: 'pluginPreferencesUnsafe',
    plugin_service_unavailable: 'pluginServiceUnavailable',
    archive_too_large: 'pluginArchiveTooLarge',
    invalid_archive: 'pluginInvalidArchive',
    invalid_manifest: 'pluginInvalidArchive',
    incompatible: 'pluginIncompatible',
    permission_reconsent_required: 'pluginReconsentRequired',
    filesystem_unsafe: 'pluginFilesystemUnsafe',
    plan_not_found: 'pluginPlanExpired',
    plugin_not_found: 'pluginNotFound',
    invalid_request: 'pluginActionFailed',
    dialog_unavailable: 'pluginActionFailed',
    install_failed: 'pluginActionFailed',
    registry_unavailable: 'pluginActionFailed',
  }
  return t(keys[code] ?? 'pluginActionFailed')
}

function setError(code: string): void {
  errorMessage.value = localizedError(code)
  statusMessage.value = ''
}

async function refreshNotifications(): Promise<void> {
  try {
    const result = await window.electronAPI?.listPluginNotifications()
    if (result?.ok) notifications.value = result.value
    else if (result && !result.ok) setError(result.error)
  } catch {
    setError('plugin_action_failed')
  }
}

async function refreshPanel(): Promise<void> {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI?.getPluginPanelSnapshot()
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      else setError('plugin_service_unavailable')
      return
    }
    snapshot.value = result.value
    if (!result.value.plugins.some(plugin => plugin.id === selectedPluginId.value)) {
      selectedPluginId.value = result.value.plugins[0]?.id ?? ''
    }
    await refreshNotifications()
  } catch {
    setError('plugin_service_unavailable')
  } finally {
    loading.value = false
  }
}

async function refreshDiagnostics(pluginId = selectedPluginId.value): Promise<void> {
  logs.value = []
  diagnostics.value = []
  if (!pluginId) return
  try {
    const result = await window.electronAPI?.getPluginDiagnostics(pluginId)
    if (result?.ok) {
      logs.value = result.value.logs
      diagnostics.value = result.value.diagnostics
    } else if (result && !result.ok) setError(result.error)
  } catch {
    setError('plugin_action_failed')
  }
}

async function updateGlobalPreferences(patch: Partial<Pick<PluginPreferences, 'pluginsEnabled'>>): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginGlobalPreferences(patch)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (snapshot.value) snapshot.value.preferences = result.value
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function updatePluginPreference(
  pluginId: string,
  patch: { enabled?: boolean; muted?: boolean },
): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginInstancePreferences(pluginId, patch)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (snapshot.value) snapshot.value.preferences = result.value
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function selectArchive(): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginArchive()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error)
      return
    }
    pendingPlan.value = result.value
    if (result.value.kind === 'incompatible') setError('incompatible')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

function planKindLabel(plan: PluginInstallPlan): string {
  const keys: Record<PluginInstallPlan['kind'], TranslationKey> = {
    new: 'pluginInstallNew',
    update: 'pluginInstallUpdate',
    downgrade: 'pluginInstallDowngrade',
    reinstall: 'pluginInstallReinstall',
    incompatible: 'pluginIncompatible',
  }
  return t(keys[plan.kind])
}

function permissionLabel(unit: string): string {
  const separator = unit.indexOf(':')
  const kind = separator < 0 ? unit : unit.slice(0, separator)
  const detail = separator < 0 ? '' : unit.slice(separator + 1)
  if (kind === 'network') return t('pluginPermissionNetwork', { host: detail })
  if (kind === 'storage') return t('pluginPermissionStorage')
  if (kind === 'agentStatus') return t('pluginPermissionAgentStatus')
  if (kind === 'schedule') return t('pluginPermissionSchedule')
  if (kind === 'secrets') return t('pluginPermissionSecret', { name: detail })
  if (detail === 'feed') return t('pluginPermissionFeed')
  if (detail === 'reaction') return t('pluginPermissionReaction')
  if (detail === 'panelView') return t('pluginPermissionPanel')
  return unit
}

const pendingPermissions = computed(() => {
  const plan = pendingPlan.value
  if (!plan) return []
  const permissionUnits: string[] = []
  for (const host of plan.permissions?.network?.hosts ?? []) permissionUnits.push(`network:${host}`)
  if (plan.permissions?.storage) permissionUnits.push('storage')
  if (plan.permissions?.agentStatus) permissionUnits.push('agentStatus')
  if (plan.permissions?.schedule) permissionUnits.push('schedule')
  for (const secret of plan.permissions?.secrets ?? []) permissionUnits.push(`secrets:${secret}`)
  if (plan.contributes?.feed) permissionUnits.push('contributes:feed')
  if (plan.contributes?.reaction) permissionUnits.push('contributes:reaction')
  if (plan.contributes?.panelView) permissionUnits.push('contributes:panelView')
  return permissionUnits.map(permissionLabel)
})

async function confirmInstall(): Promise<void> {
  const plan = pendingPlan.value
  if (!plan || plan.kind === 'incompatible' || busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.installPluginPlan(plan.token, plan.requiresReconsent)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingPlan.value = null
    statusMessage.value = t('pluginInstallSucceeded', { name: pluginName(result.value) })
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

function requestRemove(plugin: PluginPanelPlugin): void {
  pendingRemove.value = plugin
  keepData.value = false
}

async function confirmRemove(): Promise<void> {
  const plugin = pendingRemove.value
  if (!plugin || busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.removeInstalledPlugin(plugin.id, keepData.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingRemove.value = null
    statusMessage.value = t('pluginRemoveSucceeded')
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function markNotificationRead(itemId: string): Promise<void> {
  try {
    const result = await window.electronAPI?.markPluginNotificationRead(itemId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    await refreshNotifications()
  } catch {
    setError('plugin_action_failed')
  }
}

async function openNotificationLink(itemId: string): Promise<void> {
  try {
    const opened = await window.electronAPI?.openPluginFeedLink(itemId)
    if (!opened) setError('plugin_action_failed')
  } catch {
    setError('plugin_action_failed')
  }
}

async function clearNotifications(pluginId?: string): Promise<void> {
  try {
    const result = await window.electronAPI?.clearPluginNotifications(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    await refreshNotifications()
  } catch {
    setError('plugin_action_failed')
  }
}

function notificationSource(item: PluginNotificationRecord): string {
  return plugins.value.find(plugin => plugin.id === item.item.pluginId)?.manifest?.name[locale.value]
    ?? item.item.pluginName[locale.value]
}

function notificationTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
}

function diagnosticTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function diagnosticCodeLabel(item: PluginBrokerDiagnostic): string {
  return t('pluginDiagnosticRejected', { code: item.code, method: item.method ?? t('pluginDiagnosticUnknownMethod') })
}

watch(selectedPluginId, pluginId => { void refreshDiagnostics(pluginId) })

onMounted(() => {
  void refreshPanel()
  removeNotificationsListener = window.electronAPI?.onPluginNotificationsChanged(() => {
    void refreshNotifications()
  }) ?? null
})

onUnmounted(() => {
  removeNotificationsListener?.()
})
</script>

<template>
  <div class="plugin-panel">
    <div class="plugin-toolbar">
      <ToggleRow
        :model-value="enabledGlobally"
        :label="t('pluginGlobalEnabled')"
        :help="t('pluginGlobalEnabledHelp')"
        :disabled="busy"
        @update:model-value="updateGlobalPreferences({ pluginsEnabled: $event })"
      />
      <div class="plugin-toolbar-actions">
        <Button variant="secondary" size="sm" :disabled="loading || busy" @click="refreshPanel">
          {{ loading ? t('checking') : t('refresh') }}
        </Button>
        <Button variant="primary" size="sm" :disabled="busy" @click="selectArchive">
          {{ t('pluginInstallButton') }}
        </Button>
      </div>
    </div>

    <div v-if="errorMessage" class="error-msg plugin-message" role="alert">{{ errorMessage }}</div>
    <div v-if="statusMessage" class="plugin-message plugin-success" role="status" aria-live="polite">{{ statusMessage }}</div>

    <section class="plugin-section">
      <div class="plugin-section-heading">
        <div>
          <h3>{{ t('pluginInstalledHeading') }}</h3>
          <p>{{ t('pluginInstalledHelp') }}</p>
        </div>
        <span class="plugin-count" aria-live="polite">{{ plugins.length }}</span>
      </div>
      <div v-if="loading && plugins.length === 0" class="plugin-empty">{{ t('checking') }}</div>
      <div v-else-if="plugins.length === 0" class="plugin-empty">{{ t('pluginNoInstalled') }}</div>
      <div v-else class="plugin-list" role="list" :aria-label="t('pluginInstalledHeading')">
        <Card v-for="plugin in plugins" :key="plugin.id" class="plugin-card" role="listitem" :tone="pluginStatusTone(plugin)">
          <div class="plugin-row">
            <img v-if="pluginIconUrl(plugin)" class="plugin-icon" :src="pluginIconUrl(plugin) ?? ''" alt="" />
            <div v-else class="plugin-icon plugin-icon-placeholder" aria-hidden="true">◇</div>
            <div class="plugin-copy">
              <strong :title="pluginName(plugin)">{{ pluginName(plugin) }}</strong>
              <span>{{ plugin.id }} · {{ t('pluginVersion', { version: plugin.currentVersion }) }}</span>
            </div>
            <span class="plugin-status" :class="`tone-${pluginStatusTone(plugin)}`">{{ pluginStatusLabel(plugin) }}</span>
          </div>
          <div class="plugin-controls">
            <ToggleRow
              :model-value="plugin.preference.enabled"
              :label="t('pluginEnabled')"
              :disabled="busy || !plugin.manifest || plugin.status === 'incompatible'"
              @update:model-value="updatePluginPreference(plugin.id, { enabled: $event })"
            />
            <ToggleRow
              :model-value="plugin.preference.muted"
              :label="t('pluginMuted')"
              :disabled="busy || !plugin.manifest"
              @update:model-value="updatePluginPreference(plugin.id, { muted: $event })"
            />
            <Button variant="danger" size="sm" :disabled="busy" @click="requestRemove(plugin)">
              {{ t('remove') }}
            </Button>
          </div>
        </Card>
      </div>
    </section>

    <section class="plugin-section">
      <div class="plugin-section-heading">
        <div>
          <h3>{{ t('pluginDiagnosticsHeading') }}</h3>
          <p>{{ t('pluginDiagnosticsHelp') }}</p>
        </div>
        <Select v-model="selectedPluginId" size="sm" :aria-label="t('pluginDiagnosticsHeading')" :disabled="plugins.length === 0">
          <option v-for="plugin in plugins" :key="plugin.id" :value="plugin.id">{{ pluginName(plugin) }}</option>
        </Select>
      </div>
      <template v-if="selectedPluginId">
        <div class="plugin-subheading">{{ t('pluginRecentLogs') }}</div>
        <div v-if="logs.length === 0" class="plugin-empty compact">{{ t('pluginNoLogs') }}</div>
        <ul v-else class="plugin-diagnostic-list">
          <li v-for="(entry, index) in logs" :key="`${entry.at}-${index}`">
            <time>{{ diagnosticTime(entry.at) }}</time>
            <span class="plugin-log-level" :class="`level-${entry.level}`">{{ entry.level }}</span>
            <span class="plugin-log-message">{{ entry.message }}</span>
          </li>
        </ul>
        <div class="plugin-subheading">{{ t('pluginRejectedCalls') }}</div>
        <div v-if="diagnostics.length === 0" class="plugin-empty compact">{{ t('pluginNoDiagnostics') }}</div>
        <ul v-else class="plugin-diagnostic-list">
          <li v-for="(entry, index) in diagnostics" :key="`${entry.at}-${index}`">
            <time>{{ diagnosticTime(entry.at) }}</time>
            <span class="plugin-log-message">{{ diagnosticCodeLabel(entry) }}</span>
          </li>
        </ul>
        <Button variant="secondary" size="sm" @click="refreshDiagnostics()">{{ t('refresh') }}</Button>
      </template>
      <div v-else class="plugin-empty compact">{{ t('pluginSelectForDiagnostics') }}</div>
    </section>

    <section class="plugin-section">
      <div class="plugin-section-heading">
        <div>
          <h3>{{ t('pluginNotificationsHeading') }}</h3>
          <p>{{ t('pluginNotificationsHelp') }}</p>
        </div>
        <Button variant="secondary" size="sm" :disabled="notifications.length === 0" @click="clearNotifications()">
          {{ t('pluginClearAll') }}
        </Button>
      </div>
      <div v-if="notifications.length === 0" class="plugin-empty">{{ t('pluginNoNotifications') }}</div>
      <ul v-else class="plugin-notification-list">
        <li v-for="record in notifications" :key="record.item.id" :class="{ read: record.read }">
          <div class="plugin-notification-copy">
            <strong>{{ notificationSource(record) }}</strong>
            <time>{{ notificationTime(record.item.createdAt) }}</time>
            <span>{{ record.item.title }} · {{ record.item.body }}</span>
          </div>
          <div class="plugin-notification-actions">
            <Button v-if="record.item.link" variant="ghost" size="sm" @click="openNotificationLink(record.item.id)">
              {{ t('pluginFeedOpenLink') }}
            </Button>
            <Button v-if="!record.read" variant="secondary" size="sm" @click="markNotificationRead(record.item.id)">
              {{ t('pluginMarkRead') }}
            </Button>
          </div>
        </li>
      </ul>
    </section>

    <ConfirmDialog
      :open="hasCompatiblePlan"
      :title="t('pluginInstallConfirmTitle')"
      :message="t('pluginThirdPartyWarning')"
      :confirm-label="t('pluginInstallConfirm')"
      :cancel-label="t('cancel')"
      @confirm="confirmInstall"
      @cancel="pendingPlan = null"
    >
      <div v-if="pendingPlan" class="plugin-plan-content">
        <p>{{ t('pluginPlanSummary', {
          name: pendingPluginName,
          version: pendingPlan.version ?? '',
          author: pendingPlan.author ?? '',
          kind: planKindLabel(pendingPlan),
        }) }}</p>
        <p v-if="pendingPlan.kind === 'downgrade'" class="plugin-plan-warning">{{ t('pluginDowngradeWarning') }}</p>
        <p v-if="pendingPlan.requiresReconsent" class="plugin-plan-warning">{{ t('pluginNewPermissionWarning') }}</p>
        <h3>{{ t('pluginRequestedPermissions') }}</h3>
        <ul v-if="pendingPermissions.length">
          <li v-for="permission in pendingPermissions" :key="permission">{{ permission }}</li>
        </ul>
        <p v-else>{{ t('pluginNoExtraPermissions') }}</p>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      :open="pendingRemove !== null"
      :title="t('pluginRemoveConfirmTitle', { name: pendingRemove ? pluginName(pendingRemove) : '' })"
      :message="t('pluginRemoveConfirmHelp')"
      :confirm-label="t('remove')"
      :cancel-label="t('cancel')"
      tone="danger"
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    >
      <label class="plugin-keep-data">
        <input v-model="keepData" type="checkbox" />
        <span>{{ t('pluginKeepData') }}</span>
      </label>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.plugin-panel { display: flex; flex-direction: column; gap: var(--space-4); }
.plugin-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.plugin-toolbar-actions { display: flex; gap: var(--space-2); }
.plugin-message { margin: 0; }
.plugin-success { color: var(--text-success, var(--text-primary)); font-size: var(--font-sm); }
.plugin-section { display: flex; flex-direction: column; gap: var(--space-3); }
.plugin-section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 0; }
.plugin-section-heading h3 { margin: 0; color: var(--text-primary); font-size: var(--font-md); }
.plugin-section-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: var(--font-xs); }
.plugin-count { flex: 0 0 auto; color: var(--text-muted); font-size: var(--font-xs); }
.plugin-list { display: flex; flex-direction: column; gap: var(--space-2); }
.plugin-card { min-width: 0; }
.plugin-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.plugin-icon { width: 32px; height: 32px; flex: 0 0 32px; border-radius: var(--radius-sm); object-fit: contain; background: var(--surface-raised); }
.plugin-icon-placeholder { display: grid; place-items: center; color: var(--text-muted); font-size: var(--font-lg); }
.plugin-copy { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 2px; }
.plugin-copy strong { overflow: hidden; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; }
.plugin-copy span { overflow: hidden; color: var(--text-muted); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.plugin-status { flex: 0 0 auto; max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-xs); }
.tone-success { color: var(--text-success, var(--accent)); }
.tone-warn { color: var(--text-warning, var(--text-secondary)); }
.tone-neutral { color: var(--text-muted); }
.plugin-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: var(--space-3); margin-top: var(--space-2); }
.plugin-empty { padding: var(--space-3); color: var(--text-muted); font-size: var(--font-sm); text-align: center; }
.plugin-empty.compact { padding: var(--space-2); text-align: left; }
.plugin-subheading { color: var(--text-secondary); font-size: var(--font-xs); font-weight: var(--weight-medium); }
.plugin-diagnostic-list, .plugin-notification-list { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }
.plugin-diagnostic-list { max-height: 180px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
.plugin-diagnostic-list li { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-xs); }
.plugin-diagnostic-list li:last-child, .plugin-notification-list li:last-child { border-bottom: 0; }
.plugin-diagnostic-list time, .plugin-notification-copy time { flex: 0 0 auto; color: var(--text-muted); font-size: 10px; }
.plugin-log-level { flex: 0 0 auto; text-transform: uppercase; }
.level-error { color: var(--text-danger, #c33); }
.level-warn { color: var(--text-warning, #a70); }
.plugin-log-message { min-width: 0; overflow-wrap: anywhere; color: var(--text-secondary); }
.plugin-notification-list { border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
.plugin-notification-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; padding: var(--space-2); border-bottom: 1px solid var(--border-subtle); }
.plugin-notification-list li.read { opacity: .68; }
.plugin-notification-copy { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 3px; }
.plugin-notification-copy strong, .plugin-notification-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-notification-copy strong { color: var(--text-primary); font-size: var(--font-xs); }
.plugin-notification-copy span { color: var(--text-secondary); font-size: var(--font-xs); }
.plugin-notification-actions { display: flex; flex: 0 0 auto; gap: 4px; }
.plugin-plan-content { color: var(--text-secondary); font-size: var(--font-xs); }
.plugin-plan-content p { margin: 0 0 6px; }
.plugin-plan-content h3 { margin: 8px 0 4px; color: var(--text-primary); font-size: var(--font-sm); }
.plugin-plan-content ul { max-height: 110px; overflow: auto; margin: 0; padding-left: 18px; }
.plugin-plan-warning { color: var(--text-warning, var(--text-secondary)); font-weight: var(--weight-medium); }
.plugin-keep-data { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--font-sm); }
.plugin-keep-data input { accent-color: var(--accent); }

@media (max-width: 620px) {
  .plugin-controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .plugin-controls > :last-child { grid-column: 1 / -1; justify-self: end; }
  .plugin-status { max-width: 28%; }
  .plugin-notification-list li { align-items: flex-start; flex-direction: column; }
}
</style>
