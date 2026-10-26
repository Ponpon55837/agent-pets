<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { isCurrentPluginPanelViewClose, pluginPanelViewCloseError } from '@/utils/plugin-panel-view'
import type {
  PluginBrokerDiagnostic,
  PluginBrokerLogEntry,
  PluginInstallPlan,
  PluginGlobalPreferencesPatch,
  PluginNotificationRecord,
  PluginPanelPlugin,
  PluginPanelSettingsSnapshot,
  PluginPanelSnapshot,
  PluginPanelViewClosedEvent,
  PluginResourceLimits,
  PluginInstancePreferences,
  PluginPreferences,
  PluginSettingScalar,
} from '@/types/plugin'
import { isValidPetId } from '@/utils/pet-id'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const props = defineProps<{ requestedPluginId?: string }>()

const snapshot = ref<PluginPanelSnapshot | null>(null)
const notifications = ref<PluginNotificationRecord[]>([])
const logs = ref<PluginBrokerLogEntry[]>([])
const diagnostics = ref<PluginBrokerDiagnostic[]>([])
const petOptions = ref<Array<{ id: string; displayName: string }>>([])
const pluginSettings = ref<PluginPanelSettingsSnapshot | null>(null)
const settingsDraft = ref<Record<string, PluginSettingScalar>>({})
const secretDrafts = ref<Record<string, string>>({})
const selectedPluginId = ref('')
const panelViewPluginId = ref('')
const panelViewOpenToken = ref(0)
const panelViewFrame = ref<HTMLElement | null>(null)
const panelViewContent = ref<HTMLElement | null>(null)
const busy = ref(false)
const invokingCommandId = ref('')
const loading = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const pendingPlan = ref<PluginInstallPlan | null>(null)
const pendingRemove = ref<PluginPanelPlugin | null>(null)
const pendingSecretConsentKey = ref('')
const keepData = ref(false)
let removeNotificationsListener: (() => void) | null = null
let removePanelClosedListener: (() => void) | null = null
let panelViewBoundsObserver: ResizeObserver | null = null
let panelViewRequestSequence = 0

const plugins = computed(() => snapshot.value?.plugins ?? [])
const selectedPlugin = computed(() => plugins.value.find(plugin => plugin.id === selectedPluginId.value) ?? null)
const panelViewPlugin = computed(() => plugins.value.find(plugin => plugin.id === panelViewPluginId.value) ?? null)
const enabledGlobally = computed(() => snapshot.value?.preferences.pluginsEnabled ?? false)
const hasCompatiblePlan = computed(() => Boolean(pendingPlan.value && pendingPlan.value.kind !== 'incompatible'))
const pendingPluginName = computed(() => pendingPlan.value?.name?.[locale.value] ?? pendingPlan.value?.pluginId ?? '')
const resourceFields: Array<{
  key: keyof PluginResourceLimits
  label: TranslationKey
  defaultValue: number
  min: number
  max: number
}> = [
  { key: 'maxEnabledPlugins', label: 'pluginResourceMaxEnabled', defaultValue: 10, min: 1, max: 50 },
  { key: 'memoryMbPerPlugin', label: 'pluginResourceMemory', defaultValue: 64, min: 16, max: 512 },
  { key: 'netMaxResponseBytes', label: 'pluginResourceNetBytes', defaultValue: 2 * 1024 * 1024, min: 64 * 1024, max: 20 * 1024 * 1024 },
  { key: 'netTimeoutSeconds', label: 'pluginResourceNetTimeout', defaultValue: 15, min: 5, max: 60 },
  { key: 'netRequestsPerMinute', label: 'pluginResourceNetRate', defaultValue: 30, min: 1, max: 300 },
  { key: 'storageBytesPerPlugin', label: 'pluginResourceStorage', defaultValue: 1024 * 1024, min: 64 * 1024, max: 50 * 1024 * 1024 },
  { key: 'globalFeedPer10Min', label: 'pluginResourceGlobalFeed', defaultValue: 60, min: 10, max: 300 },
  { key: 'scheduleMinIntervalSeconds', label: 'pluginResourceSchedule', defaultValue: 60, min: 30, max: 3_600 },
]

function pluginName(plugin: PluginPanelPlugin): string {
  return plugin.manifest?.name[locale.value] ?? plugin.id
}

function pluginIconUrl(plugin: PluginPanelPlugin): string | null {
  const icon = plugin.manifest?.icon
  if (!icon) return null
  return `agent-pets://plugin/${plugin.id}/${icon.split('/').map(encodeURIComponent).join('/')}`
}

function readPluginPanelViewBounds(): { frame: DOMRect; content: DOMRect } | null {
  const frame = panelViewFrame.value?.getBoundingClientRect()
  const content = panelViewContent.value?.getBoundingClientRect()
  if (!frame || !content || frame.width < 1 || frame.height < 1 || content.width < 1 || content.height < 1) return null
  return { frame, content }
}

function sendPluginPanelViewBounds(): void {
  const openToken = panelViewOpenToken.value
  const bounds = readPluginPanelViewBounds()
  if (!openToken || !bounds) return
  window.electronAPI?.setPluginPanelViewBounds(
    openToken,
    { x: bounds.frame.left, y: bounds.frame.top, width: bounds.frame.width, height: bounds.frame.height },
    { x: bounds.content.left, y: bounds.content.top, width: bounds.content.width, height: bounds.content.height },
  )
}

async function openPluginPanelView(pluginId: string): Promise<void> {
  const plugin = plugins.value.find(item => item.id === pluginId)
  if (!plugin?.manifest?.contributes.panelView || !plugin.preference.enabled || !enabledGlobally.value) {
    setError('disabled')
    return
  }
  const requestSequence = ++panelViewRequestSequence
  const previousOpenToken = panelViewOpenToken.value
  panelViewOpenToken.value = 0
  if (previousOpenToken) window.electronAPI?.closePluginPanelView(previousOpenToken)
  selectedPluginId.value = pluginId
  panelViewPluginId.value = pluginId
  errorMessage.value = ''
  await nextTick()
  if (requestSequence !== panelViewRequestSequence) return
  const bounds = readPluginPanelViewBounds()
  if (!bounds) {
    panelViewPluginId.value = ''
    setError('panel_unavailable')
    return
  }
  try {
    const result = await window.electronAPI?.openPluginPanelView(
      pluginId,
      { x: bounds.frame.left, y: bounds.frame.top, width: bounds.frame.width, height: bounds.frame.height },
      { x: bounds.content.left, y: bounds.content.top, width: bounds.content.width, height: bounds.content.height },
    )
    if (requestSequence !== panelViewRequestSequence) {
      if (result?.ok) window.electronAPI?.closePluginPanelView(result.value.openToken)
      return
    }
    if (!result?.ok) {
      panelViewPluginId.value = ''
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    panelViewOpenToken.value = result.value.openToken
    await nextTick()
    sendPluginPanelViewBounds()
  } catch {
    if (requestSequence !== panelViewRequestSequence) return
    panelViewPluginId.value = ''
    setError('plugin_service_unavailable')
  }
}

function closePluginPanelView(): void {
  panelViewRequestSequence += 1
  const openToken = panelViewOpenToken.value
  panelViewOpenToken.value = 0
  panelViewPluginId.value = ''
  if (openToken) window.electronAPI?.closePluginPanelView(openToken)
}

function handlePluginPanelViewClosed(event: PluginPanelViewClosedEvent): void {
  if (!isCurrentPluginPanelViewClose(event, panelViewPluginId.value, panelViewOpenToken.value)) return
  panelViewRequestSequence += 1
  panelViewOpenToken.value = 0
  panelViewPluginId.value = ''
  if (event.reason !== 'hidden') setError(pluginPanelViewCloseError(event.reason))
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
  if (code === 'too_many_enabled') {
    return t('pluginTooManyEnabled', {
      limit: String(snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10),
    })
  }
  const keys: Record<string, TranslationKey> = {
    disabled: 'pluginPanelUnavailable',
    host_unavailable: 'pluginCommandHostUnavailable',
    not_permitted: 'pluginCommandNotPermitted',
    rate_limited: 'pluginCommandRateLimited',
    panel_unavailable: 'pluginPanelViewUnavailable',
    panel_load_failed: 'pluginPanelViewLoadFailed',
    panel_crashed: 'pluginPanelViewCrashed',
    panel_closed: 'pluginPanelViewClosed',
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
    secret_unavailable: 'pluginSecretUnavailable',
    secret_not_found: 'pluginSecretNotFound',
    secret_consent_required: 'pluginSecretConsentRequired',
    settings_invalid: 'pluginSettingsInvalid',
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
    const requestedPluginId = props.requestedPluginId
    if (requestedPluginId && result.value.plugins.some(plugin => plugin.id === requestedPluginId)) {
      selectedPluginId.value = requestedPluginId
      void openPluginPanelView(requestedPluginId)
    } else if (!result.value.plugins.some(plugin => plugin.id === selectedPluginId.value)) {
      selectedPluginId.value = result.value.plugins[0]?.id ?? ''
    }
    await refreshNotifications()
  } catch {
    setError('plugin_service_unavailable')
  } finally {
    loading.value = false
  }
}

async function loadPetOptions(): Promise<void> {
  try {
    const pets = await window.electronAPI?.loadPets()
    petOptions.value = (pets ?? []).filter(pet => isValidPetId(pet.id, 64))
      .map(pet => ({
        id: pet.id,
        displayName: pet.pluginSkin
          ? `${pet.displayName || pet.id} · ${t('pluginPetFromPlugin', { name: pet.pluginSkin.pluginName })}`
          : pet.displayName || pet.id,
      }))
  } catch {
    petOptions.value = []
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

async function refreshPluginSettings(pluginId = selectedPluginId.value): Promise<void> {
  pluginSettings.value = null
  settingsDraft.value = {}
  secretDrafts.value = {}
  const plugin = plugins.value.find(item => item.id === pluginId)
  if (!plugin?.manifest?.contributes.settings) return
  try {
    const result = await window.electronAPI?.getPluginSettings(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pluginSettings.value = result.value
    settingsDraft.value = { ...result.value.values }
    secretDrafts.value = Object.fromEntries(Object.keys(result.value.secrets).map(key => [key, '']))
  } catch {
    setError('plugin_action_failed')
  }
}

function commandTitle(command: { title: { 'zh-TW': string; 'en-US': string } }): string {
  return command.title[locale.value]
}

async function invokePluginCommand(commandId: string): Promise<void> {
  const plugin = selectedPlugin.value
  if (!plugin || invokingCommandId.value) return
  invokingCommandId.value = commandId
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.invokePluginCommand(plugin.id, commandId)
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    statusMessage.value = t('pluginCommandSent')
  } catch {
    setError('plugin_action_failed')
  } finally {
    invokingCommandId.value = ''
  }
}

function settingTitle(title: string | { 'zh-TW': string; 'en-US': string } | undefined, fallback: string): string {
  if (typeof title === 'string') return title
  return title?.[locale.value] ?? fallback
}

function settingValue(key: string, definition: { default?: PluginSettingScalar }): string {
  const value = settingsDraft.value[key] ?? definition.default ?? ''
  return String(value)
}

function updateSetting(key: string, type: string, raw: string | boolean): void {
  const value = type === 'boolean' ? Boolean(raw) : type === 'number' ? Number(raw) : String(raw)
  settingsDraft.value = { ...settingsDraft.value, [key]: value as PluginSettingScalar }
}

async function savePluginSettings(): Promise<void> {
  const pluginId = selectedPluginId.value
  if (!pluginId || busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginSettings(pluginId, settingsDraft.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    settingsDraft.value = { ...result.value }
    if (pluginSettings.value) pluginSettings.value.values = { ...result.value }
    statusMessage.value = t('pluginSettingsSaved')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function savePluginSecret(key: string): Promise<void> {
  const pluginId = selectedPluginId.value
  if (!pluginId || busy.value) return
  if ((secretDrafts.value[key] ?? '').length > 0) {
    try {
      const consent = await window.electronAPI?.getPluginSecretConsent()
      if (!consent?.ok) {
        setError(consent && !consent.ok ? consent.error : 'plugin_service_unavailable')
        return
      }
      if (!consent.value) {
        pendingSecretConsentKey.value = key
        return
      }
    } catch {
      setError('plugin_action_failed')
      return
    }
  }
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const result = await window.electronAPI?.setPluginSecret(pluginId, key, secretDrafts.value[key] ?? '')
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    if (pluginSettings.value) pluginSettings.value.secrets[key] = result.value.configured
    secretDrafts.value = { ...secretDrafts.value, [key]: '' }
    statusMessage.value = result.value.configured ? t('pluginSecretSaved') : t('pluginSettingsSaved')
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
}

async function confirmSecretConsent(): Promise<void> {
  const key = pendingSecretConsentKey.value
  if (!key || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI?.acceptPluginSecretConsent()
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    pendingSecretConsentKey.value = ''
  } catch {
    setError('plugin_action_failed')
  } finally {
    busy.value = false
  }
  if (!pendingSecretConsentKey.value) await savePluginSecret(key)
}

async function updateGlobalPreferences(patch: PluginGlobalPreferencesPatch): Promise<void> {
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

function updateResourceLimit(key: keyof PluginResourceLimits, raw: string): void {
  const field = resourceFields.find(item => item.key === key)
  const parsed = Number(raw)
  const value = key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin' ? parsed * 1024 : parsed
  if (!field || !Number.isSafeInteger(value) || value < field.min || value > field.max) {
    if (field) {
      errorMessage.value = t('pluginResourceRangeInvalid', { min: String(field.min), max: String(field.max) })
      statusMessage.value = ''
    }
    return
  }
  void updateGlobalPreferences({ resources: { [key]: value } })
}

function resourceInputValue(key: keyof PluginResourceLimits, value: number): string {
  return String(key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin' ? value / 1024 : value)
}

function resourceBoundText(key: keyof PluginResourceLimits, value: number): string {
  if (key === 'memoryMbPerPlugin') return `${value} MB`
  if (key === 'netMaxResponseBytes' || key === 'storageBytesPerPlugin') {
    const unit = value % (1024 * 1024) === 0 ? 'MB' : 'KB'
    return `${value / (unit === 'MB' ? 1024 * 1024 : 1024)} ${unit}`
  }
  if (key === 'netTimeoutSeconds' || key === 'scheduleMinIntervalSeconds') return `${value} s`
  if (key === 'netRequestsPerMinute') return `${value} / min`
  if (key === 'globalFeedPer10Min') return `${value} / 10 min`
  return String(value)
}

async function updatePluginPreference(
  pluginId: string,
  patch: Partial<Pick<PluginInstancePreferences, 'enabled' | 'muted' | 'rateLimitPer10Min' | 'targetPetId' | 'grantedHosts'>>,
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

async function updatePluginRate(pluginId: string, raw: string): Promise<void> {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 30) {
    errorMessage.value = t('pluginPerPluginRateRange')
    statusMessage.value = ''
    return
  }
  await updatePluginPreference(pluginId, { rateLimitPer10Min: value })
}

async function updatePluginTarget(pluginId: string, targetPetId: string): Promise<void> {
  await updatePluginPreference(pluginId, { targetPetId: targetPetId || null })
}

async function revokeGrantedHost(plugin: PluginPanelPlugin, host: string): Promise<void> {
  await updatePluginPreference(plugin.id, {
    grantedHosts: plugin.preference.grantedHosts.filter(item => item !== host),
  })
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

async function selectDeveloperFolder(): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginFolder()
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
  if (detail === 'commands') return t('pluginPermissionCommands')
  if (detail === 'tray') return t('pluginPermissionTray')
  if (detail === 'badge') return t('pluginPermissionBadge')
  if (detail.startsWith('skins:')) return t('pluginPermissionSkins', { count: detail.slice(6) })
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
  if (plan.contributes?.commands?.length) permissionUnits.push('contributes:commands')
  if (plan.contributes?.tray?.commands.length) permissionUnits.push('contributes:tray')
  if (plan.contributes?.badge) permissionUnits.push('contributes:badge')
  if (plan.contributes?.skins?.length) permissionUnits.push(`contributes:skins:${plan.contributes.skins.length}`)
  return permissionUnits.map(permissionLabel)
})

const pendingAddedPermissions = computed(() => (pendingPlan.value?.addedPermissions ?? []).map(permissionLabel))

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
  if (item.code === 'host_unavailable') return t('pluginHostUnavailableTitle')
  if (item.code === 'too_many_enabled') {
    if (item.method === 'plugin.tray') return t('pluginTrayOverflowDiagnostic')
    return t('pluginTooManyEnabled', {
      limit: String(snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10),
    })
  }
  return t('pluginDiagnosticRejected', { code: item.code, method: item.method ?? t('pluginDiagnosticUnknownMethod') })
}

watch(selectedPluginId, pluginId => {
  if (panelViewPluginId.value && panelViewPluginId.value !== pluginId) closePluginPanelView()
  void refreshDiagnostics(pluginId)
  void refreshPluginSettings(pluginId)
})

watch(panelViewPluginId, async pluginId => {
  panelViewBoundsObserver?.disconnect()
  panelViewBoundsObserver = null
  window.removeEventListener('resize', sendPluginPanelViewBounds)
  window.removeEventListener('scroll', sendPluginPanelViewBounds, true)
  if (!pluginId) return
  await nextTick()
  const frame = panelViewFrame.value
  const content = panelViewContent.value
  if (!frame || !content) return
  panelViewBoundsObserver = new ResizeObserver(sendPluginPanelViewBounds)
  panelViewBoundsObserver.observe(frame)
  panelViewBoundsObserver.observe(content)
  window.addEventListener('resize', sendPluginPanelViewBounds)
  window.addEventListener('scroll', sendPluginPanelViewBounds, true)
  sendPluginPanelViewBounds()
}, { flush: 'post' })

watch(() => props.requestedPluginId, pluginId => {
  if (!pluginId && panelViewPluginId.value) closePluginPanelView()
  else if (pluginId && plugins.value.some(plugin => plugin.id === pluginId)) void openPluginPanelView(pluginId)
})

onMounted(() => {
  void refreshPanel()
  void loadPetOptions()
  removePanelClosedListener = window.electronAPI?.onPluginPanelViewClosed(handlePluginPanelViewClosed) ?? null
  removeNotificationsListener = window.electronAPI?.onPluginNotificationsChanged(() => {
    void refreshNotifications()
  }) ?? null
})

onUnmounted(() => {
  removeNotificationsListener?.()
  removePanelClosedListener?.()
  panelViewBoundsObserver?.disconnect()
  window.removeEventListener('resize', sendPluginPanelViewBounds)
  window.removeEventListener('scroll', sendPluginPanelViewBounds, true)
  panelViewRequestSequence += 1
  if (panelViewOpenToken.value) window.electronAPI?.closePluginPanelView(panelViewOpenToken.value)
})
</script>

<template>
  <section
    v-if="panelViewPlugin"
    ref="panelViewFrame"
    class="plugin-panel-view-frame"
    data-testid="plugin-panel-view-frame"
  >
    <header class="plugin-panel-view-chrome">
      <img v-if="pluginIconUrl(panelViewPlugin)" :src="pluginIconUrl(panelViewPlugin) ?? ''" alt="" />
      <span v-else class="plugin-panel-view-icon" aria-hidden="true">◇</span>
      <div class="plugin-panel-view-title">
        <strong>{{ pluginName(panelViewPlugin) }}</strong>
        <span>{{ t('pluginPanelContent') }}</span>
      </div>
      <button class="plugin-panel-view-close" type="button" :aria-label="t('pluginPanelClose')" @click="closePluginPanelView">×</button>
    </header>
    <div ref="panelViewContent" class="plugin-panel-view-content" data-testid="plugin-panel-view-content" />
  </section>

  <div v-else class="plugin-panel">
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
        <Button v-if="snapshot?.preferences.developerMode" variant="secondary" size="sm" :disabled="busy" @click="selectDeveloperFolder">
          {{ t('pluginDeveloperLoadFolder') }}
        </Button>
      </div>
    </div>

    <Card :title="t('pluginAdvancedSettings')" class="plugin-section">
      <p class="plugin-limit-help">{{ t('pluginAdvancedSettingsHelp') }}</p>
      <ToggleRow
        :model-value="snapshot?.preferences.developerMode ?? false"
        :label="t('pluginDeveloperMode')"
        :help="t('pluginDeveloperModeHelp')"
        :disabled="busy || loading"
        @update:model-value="updateGlobalPreferences({ developerMode: $event })"
      />
      <div class="plugin-resource-grid">
        <label v-for="field in resourceFields" :key="field.key" class="plugin-resource-field">
          <span>{{ t(field.label) }}</span>
          <input
            type="number"
            :value="resourceInputValue(field.key, snapshot?.preferences.resources[field.key] ?? field.defaultValue)"
            :min="resourceInputValue(field.key, field.min)"
            :max="resourceInputValue(field.key, field.max)"
            step="1"
            :disabled="busy || loading"
            @change="updateResourceLimit(field.key, ($event.target as HTMLInputElement).value)"
          />
          <small>{{ t('pluginResourceRange', {
            default: resourceBoundText(field.key, field.defaultValue),
            min: resourceBoundText(field.key, field.min),
            max: resourceBoundText(field.key, field.max),
          }) }}</small>
        </label>
      </div>
    </Card>

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
              <span v-if="plugin.development" class="plugin-development-badge">{{ t('pluginDevelopmentBadge') }}</span>
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
            <label class="plugin-preference-field">
              <span>{{ t('pluginPerPluginRateLabel') }}</span>
              <input
                type="number"
                min="1"
                max="30"
                step="1"
                :value="String(plugin.preference.rateLimitPer10Min)"
                :disabled="busy || !plugin.manifest"
                @change="updatePluginRate(plugin.id, ($event.target as HTMLInputElement).value)"
              />
              <small>{{ t('pluginPerPluginRateHelp') }}</small>
            </label>
            <label class="plugin-preference-field">
              <span>{{ t('pluginTargetPetLabel') }}</span>
              <select
                :value="plugin.preference.targetPetId ?? ''"
                :disabled="busy || !plugin.manifest"
                @change="updatePluginTarget(plugin.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('pluginPrimaryPet') }}</option>
                <option v-for="pet in petOptions" :key="pet.id" :value="pet.id">{{ pet.displayName }}</option>
              </select>
            </label>
            <Button variant="danger" size="sm" :disabled="busy" @click="requestRemove(plugin)">
              {{ t('remove') }}
            </Button>
            <Button
              v-if="plugin.manifest?.contributes.panelView"
              variant="secondary"
              size="sm"
              :disabled="busy || !plugin.preference.enabled || !enabledGlobally"
              @click="openPluginPanelView(plugin.id)"
            >
              {{ t('pluginOpenPanel') }}
            </Button>
          </div>
          <div class="plugin-granted-hosts">
            <strong>{{ t('pluginManifestHostsHeading') }}</strong>
            <p v-if="(plugin.manifest?.permissions.network?.hosts ?? []).length === 0" class="plugin-empty compact">{{ t('pluginGrantedHostsEmpty') }}</p>
            <ul v-else>
              <li v-for="host in plugin.manifest?.permissions.network?.hosts ?? []" :key="host"><code>{{ host }}</code></li>
            </ul>
            <strong>{{ t('pluginGrantedHostsHeading') }}</strong>
            <p v-if="plugin.preference.grantedHosts.length === 0" class="plugin-empty compact">{{ t('pluginGrantedHostsEmpty') }}</p>
            <ul v-else>
              <li v-for="host in plugin.preference.grantedHosts" :key="host">
                <code>{{ host }}</code>
                <Button variant="ghost" size="sm" :disabled="busy" @click="revokeGrantedHost(plugin, host)">
                  {{ t('pluginRevokeHost') }}
                </Button>
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </section>

    <Card v-if="selectedPlugin?.manifest?.contributes.commands?.length" :title="t('pluginCommandsHeading')" class="plugin-section">
      <p class="plugin-limit-help">{{ t('pluginCommandsHelp') }}</p>
      <div class="plugin-command-list">
        <Button
          v-for="command in selectedPlugin.manifest.contributes.commands"
          :key="command.id"
          variant="secondary"
          size="sm"
          :disabled="Boolean(invokingCommandId) || !selectedPlugin.preference.enabled || !enabledGlobally"
          @click="invokePluginCommand(command.id)"
        >
          {{ commandTitle(command) }}
        </Button>
      </div>
    </Card>

    <Card v-if="selectedPlugin?.manifest?.contributes.settings" :title="t('pluginSettingsHeading')" class="plugin-section">
      <div v-for="(definition, key) in selectedPlugin.manifest.contributes.settings.properties" :key="key" class="plugin-setting-field">
        <template v-if="definition.format === 'secret'">
          <span class="plugin-setting-label">{{ settingTitle(definition.title, key) }}</span>
          <p class="plugin-secret-state">
            {{ pluginSettings?.secrets[key] ? t('pluginSecretConfigured') : t('pluginSecretNotConfigured') }}
          </p>
          <div class="plugin-secret-control">
            <input
              v-model="secretDrafts[key]"
              type="password"
              autocomplete="new-password"
              :maxlength="definition.maxLength ?? 4096"
              :aria-label="settingTitle(definition.title, key)"
              :disabled="busy || loading"
            />
            <Button variant="secondary" size="sm" :disabled="busy || loading" @click="savePluginSecret(key)">
              {{ t('pluginSecretSave') }}
            </Button>
          </div>
        </template>
        <template v-else>
          <label :for="`plugin-setting-${key}`" class="plugin-setting-label">{{ settingTitle(definition.title, key) }}</label>
          <input
            v-if="definition.type === 'boolean'"
            :id="`plugin-setting-${key}`"
            type="checkbox"
            :checked="Boolean(settingsDraft[key] ?? definition.default ?? false)"
            :disabled="busy || loading"
            @change="updateSetting(key, 'boolean', ($event.target as HTMLInputElement).checked)"
          />
          <select
            v-else-if="definition.enum"
            :id="`plugin-setting-${key}`"
            :value="settingValue(key, definition)"
            :disabled="busy || loading"
            @change="updateSetting(key, definition.type, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in definition.enum" :key="String(option)" :value="String(option)">{{ option }}</option>
          </select>
          <input
            v-else
            :id="`plugin-setting-${key}`"
            :type="definition.type === 'number' ? 'number' : 'text'"
            :value="settingValue(key, definition)"
            :min="definition.minimum"
            :max="definition.maximum"
            :maxlength="definition.maxLength"
            :disabled="busy || loading"
            @input="updateSetting(key, definition.type, ($event.target as HTMLInputElement).value)"
          />
        </template>
      </div>
      <Button variant="primary" size="sm" :disabled="busy || loading" @click="savePluginSettings">
        {{ t('pluginSettingsSave') }}
      </Button>
    </Card>

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
        <template v-if="pendingPlan.requiresReconsent && pendingAddedPermissions.length">
          <h3>{{ t('pluginAddedPermissions') }}</h3>
          <ul><li v-for="permission in pendingAddedPermissions" :key="permission">{{ permission }}</li></ul>
        </template>
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

    <ConfirmDialog
      :open="pendingSecretConsentKey !== ''"
      :title="t('pluginSecretConsentTitle')"
      :message="t('pluginSecretConsentMessage')"
      :confirm-label="t('pluginSecretConsentConfirm')"
      :cancel-label="t('cancel')"
      @confirm="confirmSecretConsent"
      @cancel="pendingSecretConsentKey = ''"
    />
  </div>
</template>

<style scoped>
.plugin-panel { display: flex; flex-direction: column; gap: var(--space-4); }
.plugin-panel-view-frame { display: flex; min-width: 0; min-height: 0; height: 100%; flex: 1 1 auto; flex-direction: column; overflow: hidden; border: 1px solid var(--organic-border-soft, var(--border-subtle)); border-radius: var(--radius-md); background: var(--organic-bg, Canvas); color: var(--organic-text, CanvasText); }
.plugin-panel-view-chrome { position: relative; z-index: 1; display: flex; min-height: 52px; flex: 0 0 52px; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); border-bottom: 1px solid var(--organic-border-soft, var(--border-subtle)); background: var(--organic-surface, Canvas); color: var(--organic-text, CanvasText); }
.plugin-panel-view-chrome img, .plugin-panel-view-icon { display: grid; width: 28px; height: 28px; flex: 0 0 28px; place-items: center; border-radius: var(--radius-sm); object-fit: contain; background: var(--organic-surface-2, Canvas); color: var(--organic-text-muted, CanvasText); }
.plugin-panel-view-title { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 2px; }
.plugin-panel-view-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-panel-view-title span { color: var(--organic-text-muted, var(--text-muted)); font-size: var(--font-xs); }
.plugin-panel-view-close { display: grid; width: 30px; height: 30px; flex: 0 0 30px; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--organic-text-secondary, var(--text-secondary)); cursor: pointer; font: inherit; font-size: 20px; }
.plugin-panel-view-close:hover { background: var(--organic-surface-2, var(--surface-raised)); color: var(--organic-text, var(--text-primary)); }
.plugin-panel-view-close:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.plugin-panel-view-content { min-width: 0; min-height: 0; flex: 1 1 auto; background: var(--organic-bg, Canvas); }
@media (prefers-color-scheme: dark) {
  .plugin-panel-view-frame {
    color-scheme: dark;
    --organic-bg: Canvas;
    --organic-surface: Canvas;
    --organic-surface-2: Canvas;
    --organic-text: CanvasText;
    --organic-text-secondary: CanvasText;
    --organic-text-muted: CanvasText;
    --organic-border-soft: CanvasText;
  }
}
@media (prefers-contrast: more) {
  .plugin-panel-view-frame { border-width: 2px; }
  .plugin-panel-view-chrome { border-bottom-width: 2px; }
}
@media (forced-colors: active) {
  .plugin-panel-view-frame { border: 1px solid CanvasText; }
  .plugin-panel-view-chrome { border-bottom: 1px solid CanvasText; background: Canvas; color: CanvasText; }
  .plugin-panel-view-chrome img, .plugin-panel-view-icon { background: Canvas; color: CanvasText; }
  .plugin-panel-view-close { color: ButtonText; }
  .plugin-panel-view-close:hover { background: Highlight; color: HighlightText; }
}
@media (prefers-reduced-motion: reduce) {
  .plugin-panel-view-frame, .plugin-panel-view-chrome, .plugin-panel-view-close { animation: none; transition: none; }
}
.plugin-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.plugin-toolbar-actions { display: flex; gap: var(--space-2); }
.plugin-message { margin: 0; }
.plugin-success { color: var(--text-success, var(--text-primary)); font-size: var(--font-sm); }
.plugin-limit-help { margin: 0; color: var(--text-muted); font-size: var(--font-xs); line-height: 1.5; }
.plugin-limit-control { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); color: var(--text-secondary); font-size: var(--font-sm); }
.plugin-limit-control > :deep(.select-wrap) { width: 88px; flex: 0 0 88px; }
.plugin-section { display: flex; flex-direction: column; gap: var(--space-3); }
.plugin-section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 0; }
.plugin-section-heading h3 { margin: 0; color: var(--text-primary); font-size: var(--font-md); }
.plugin-section-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: var(--font-xs); }
.plugin-count { flex: 0 0 auto; color: var(--text-muted); font-size: var(--font-xs); }
.plugin-list { display: flex; flex-direction: column; gap: var(--space-2); }
.plugin-setting-field { display: flex; flex-direction: column; gap: var(--space-2); color: var(--text-secondary); font-size: var(--font-sm); }
.plugin-setting-label { color: var(--text-primary); font-size: var(--font-sm); }
.plugin-setting-field > input:not([type="checkbox"]), .plugin-setting-field > select, .plugin-secret-control > input { width: 100%; min-height: 36px; padding: 0 var(--space-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text-primary); }
.plugin-setting-field > input[type="checkbox"] { align-self: flex-start; accent-color: var(--accent-primary); }
.plugin-secret-state { margin: 0; color: var(--text-muted); font-size: var(--font-xs); }
.plugin-secret-control { display: flex; align-items: center; gap: var(--space-2); }
.plugin-secret-control > input { min-width: 0; flex: 1 1 auto; }
.plugin-card { min-width: 0; }
.plugin-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.plugin-icon { width: 32px; height: 32px; flex: 0 0 32px; border-radius: var(--radius-sm); object-fit: contain; background: var(--surface-raised); }
.plugin-icon-placeholder { display: grid; place-items: center; color: var(--text-muted); font-size: var(--font-lg); }
.plugin-copy { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 2px; }
.plugin-copy strong { overflow: hidden; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; }
.plugin-copy span { overflow: hidden; color: var(--text-muted); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.plugin-copy .plugin-development-badge { align-self: flex-start; border-radius: var(--radius-sm); padding: 1px 5px; background: var(--surface-secondary); color: var(--text-secondary); font-size: var(--font-2xs); }
.plugin-status { flex: 0 0 auto; max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-xs); }
.tone-success { color: var(--text-success, var(--accent)); }
.tone-warn { color: var(--text-warning, var(--text-secondary)); }
.tone-neutral { color: var(--text-muted); }
.plugin-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: var(--space-3); margin-top: var(--space-2); }
.plugin-preference-field, .plugin-resource-field { display: flex; flex-direction: column; gap: var(--space-1); color: var(--text-secondary); font-size: var(--font-xs); }
.plugin-preference-field input, .plugin-preference-field select, .plugin-resource-field input { width: 100%; min-width: 0; min-height: 34px; padding: 0 var(--space-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text-primary); }
.plugin-preference-field small, .plugin-resource-field small { color: var(--text-muted); line-height: 1.4; }
.plugin-resource-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3); }
.plugin-granted-hosts { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); }
.plugin-granted-hosts > strong { color: var(--text-secondary); font-size: var(--font-xs); }
.plugin-granted-hosts ul { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.plugin-granted-hosts li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.plugin-granted-hosts code { overflow-wrap: anywhere; color: var(--text-primary); }
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
