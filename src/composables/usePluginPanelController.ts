// Plugin 面板控制器：建立共用依賴（忙碌範圍、序列佇列、refresh、錯誤通知），組裝各功能 composable，
// 並保留跨功能的狀態（快照、目前選取／詳情頁的插件）與尚未拆出的 catalog、安裝、偏好。
// 對元件的回傳欄位與型別固定（tests/plugin-panel-controller-characterization.test.mts）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { resolvePluginIconUrl } from '@/utils/plugin-icon'
import type {
  PluginBadgeView,
  PluginEventSourceStatusView,
  PluginInstallPlan,
  PluginGlobalPreferencesPatch,
  PluginPanelPlugin,
  PluginPanelSnapshot,
  PluginResourceLimits,
  PluginLocalizedText,
} from '@/types/plugin'
import type { PluginCatalogPanelItem } from '@/types/plugin-catalog'
import { DEFAULT_PLUGIN_CATALOG_URL } from '@/types/plugin-catalog'
import { isValidPetId } from '@/utils/pet-id'
import { installAcknowledgementReasons, permissionUnitsOfPlan } from '@/utils/plugin-permissions'
import {
  permissionHint, permissionLabel, toPermissionGroupViews, type PermissionGroupView,
} from '@/utils/plugin-permission-copy'
import { resourceBoundText, resourceInputValue, resourceValueFromInput } from '@/utils/plugin-resource-limits'
import {
  applyPreferencePatch, createSerialQueue, mergePreferencesResult, rollbackPreferencePatch,
  type PluginPreferencePatch,
} from '@/composables/plugin/plugin-state-sync'
import { createBusyScopes, createPluginPanelFeedback, createQueuedRefresh, pluginScope } from '@/composables/plugin/panel-deps'
import { usePluginNotify } from '@/composables/plugin/usePluginNotify'
import { usePluginSettingsEditor } from '@/composables/plugin/usePluginSettingsEditor'
import { usePluginPanelView } from '@/composables/plugin/usePluginPanelView'
import { usePluginNotifications } from '@/composables/plugin/usePluginNotifications'
import { usePluginDiagnostics } from '@/composables/plugin/usePluginDiagnostics'
import { pluginDetailRequestNonce, takePluginDetailRequest } from '@/utils/plugin-detail-request'
import { isKeyFingerprint } from '@/types/id-patterns'

export type { PermissionEntryView, PermissionGroupView } from '@/utils/plugin-permission-copy'

// 跨元件重新掛載保留：已處理過的最後一個面板開啟請求序號。
let consumedPanelRequestNonce = 0

export type PluginInstalledFilter = 'all' | 'enabled' | 'updates' | 'issues'

export type PluginDetailSection = 'overview' | 'settings' | 'commands' | 'themes' | 'diagnostics'

// 這四個欄位一直回傳「建立當下的初始值」（不是 ref；原本的型別也因控制流收斂成 null），元件不讀；
// 保留只為了不改對外欄位與型別。
interface LegacyInitialValues {
  removeNotificationsListener: null
  removePanelClosedListener: null
  panelViewBoundsObserver: null
  panelViewRequestSequence: number
}

export function usePluginPanelController(props: { requestedPluginId?: string; requestNonce?: number }) {

// --- 共用依賴與跨功能狀態 ------------------------------------------------------

const snapshot = ref<PluginPanelSnapshot | null>(null)
const notifier = usePluginNotify()
const { busy, isBusy, pluginBusy, setBusy } = createBusyScopes()
const enqueueSerial = createSerialQueue()
const maxEnabledPlugins = () => snapshot.value?.preferences.resources.maxEnabledPlugins ?? 10
const feedback = createPluginPanelFeedback(notifier.notify, maxEnabledPlugins)
const { localizedError, setError, setStatus } = feedback

const plugins = computed(() => snapshot.value?.plugins ?? [])
const pluginsById = computed(() => new Map(plugins.value.map(plugin => [plugin.id, plugin])))
function pluginById(pluginId: string): PluginPanelPlugin | null {
  return pluginsById.value.get(pluginId) ?? null
}
const selectedPluginId = ref('')
const selectedPlugin = computed(() => pluginById(selectedPluginId.value))
const detailPluginId = ref('')
const detailSection = ref<PluginDetailSection>('overview')
const detailPlugin = computed(() => pluginById(detailPluginId.value))
const enabledGlobally = computed(() => snapshot.value?.preferences.pluginsEnabled ?? false)
const onlineCatalogEnabled = computed(() => snapshot.value?.preferences.onlineCatalogEnabled ?? false)
const dailyUpdateCheck = computed(() => snapshot.value?.preferences.dailyUpdateCheck ?? false)
const loading = ref(false)
const liveBadges = ref<PluginBadgeView[]>([])
const eventSourceStatuses = ref<PluginEventSourceStatusView[]>([])
const petOptions = ref<Array<{ id: string; displayName: string }>>([])
let removeBadgesListener: (() => void) | null = null
let removeEventSourceListener: (() => void) | null = null

// --- 功能 composable ----------------------------------------------------------

const {
  pluginSettings, settingsDraft, secretDrafts, settingsErrors, settingsDirty, pendingLeave, pendingSecretRemoveKey,
  pendingSecretConsentKey, guardUnsavedSettings, confirmDiscardSettings, resetSettingsDraft, resetSettingsToDefaults,
  refreshPluginSettings, settingTitle, settingValue, updateSetting, savePluginSettings, savePluginSecret,
  removePluginSecret, confirmSecretConsent,
} = usePluginSettingsEditor({ selectedPluginId, selectedPlugin, pluginById, busy: { isBusy, setBusy }, feedback })

const {
  panelViewPluginId, panelViewOpenToken, panelViewFrame, panelViewContent, panelViewMaximized, panelViewError,
  panelViewPlugin, readPluginPanelViewBounds, sendPluginPanelViewBounds, openPluginPanelView, closePluginPanelView,
  reloadPluginPanelView, togglePluginPanelViewMaximized, handlePluginPanelViewClosed,
} = usePluginPanelView({
  pluginById,
  enabledGlobally,
  selectPlugin: pluginId => { selectedPluginId.value = pluginId },
  setError: code => setError(code),
})

const {
  notifications, visibleNotifications, refreshNotifications, markNotificationRead, openNotificationLink,
  clearNotifications, markAllNotificationsRead, notificationSource, notificationTime,
} = usePluginNotifications({ pluginById, feedback })

const {
  logs, diagnostics, refreshDiagnostics, diagnosticTime, diagnosticCodeLabel, diagnosticTechnical,
} = usePluginDiagnostics({ selectedPluginId, maxEnabledPlugins, feedback })

const legacyInitialValues: LegacyInitialValues = {
  removeNotificationsListener: null,
  removePanelClosedListener: null,
  panelViewBoundsObserver: null,
  panelViewRequestSequence: 0,
}

// --- 尚未拆出的狀態：指令、catalog、安裝、移除、回報 -----------------------------------

const invokingCommandId = ref('')
const pendingPlan = ref<PluginInstallPlan | null>(null)
const pendingRemove = ref<PluginPanelPlugin | null>(null)
const pendingReportPluginId = ref('')
const catalogItems = ref<PluginCatalogPanelItem[]>([])
const catalogById = computed(() => new Map(catalogItems.value.map(item => [item.plugin.id, item])))
const catalogCheckComplete = ref(false)
const catalogLoadedAt = ref<number | null>(null)
const catalogError = ref('')
const updateQueue = ref<PluginCatalogPanelItem[]>([])
const catalogSearch = ref('')
const catalogUrlDraft = ref('')
const keepData = ref(false)
const failedPluginIconIds = ref(new Set<string>())

// --- 已安裝清單 ---------------------------------------------------------------

const installedSearch = ref('')
const installedFilter = ref<PluginInstalledFilter>('all')
const filteredPlugins = computed(() => {
  const query = installedSearch.value.trim().toLocaleLowerCase()
  const filter = installedFilter.value
  const updatable = filter === 'updates'
    ? new Set(catalogItems.value.filter(item => item.updateAvailable).map(item => item.plugin.id))
    : null
  const tones = new Map(plugins.value.map(plugin => [plugin.id, pluginStatusTone(plugin)]))
  const matches = plugins.value.filter(plugin => {
    if (filter === 'enabled' && !plugin.preference.enabled) return false
    if (filter === 'issues' && tones.get(plugin.id) !== 'warn') return false
    if (updatable && !updatable.has(plugin.id)) return false
    if (!query) return true
    return [plugin.id, pluginName(plugin), plugin.manifest?.author ?? ''].some(value => value.toLocaleLowerCase().includes(query))
  })
  // 需要處理的插件（崩潰、不相容）排在最前面；sort 是穩定排序，其餘維持原本順序。
  const warn = (plugin: PluginPanelPlugin) => Number(tones.get(plugin.id) === 'warn')
  return matches.sort((left, right) => warn(right) - warn(left))
})
const filteredCatalogItems = computed(() => {
  const query = catalogSearch.value.trim().toLocaleLowerCase()
  if (!query) return catalogItems.value
  return catalogItems.value.filter(item => [
    item.plugin.id,
    item.plugin.name[locale.value],
    item.plugin.description[locale.value],
    item.plugin.author,
  ].some(value => value.toLocaleLowerCase().includes(query)))
})
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
  return resolvePluginIconUrl(
    plugin.id,
    plugin.manifest?.icon,
    plugin.preference.enabled,
    snapshot.value?.preferences.pluginsEnabled === true,
    failedPluginIconIds.value.has(plugin.id),
  )
}

function hidePluginIcon(pluginId: string): void {
  failedPluginIconIds.value = new Set([...failedPluginIconIds.value, pluginId])
}

function displayFingerprint(value: string | undefined): string {
  return isKeyFingerprint(value)
    ? value.match(/.{4}/g)?.join(' ') ?? ''
    : ''
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

// --- 詳情頁 -------------------------------------------------------------------

// 詳情頁是目前插件唯一的來源；診斷、設定、指令都跟著它走，不再由別處的下拉決定。
function openPluginDetail(pluginId: string, section: PluginDetailSection = 'overview'): void {
  if (!pluginsById.value.has(pluginId)) return
  const open = () => {
    detailSection.value = section
    detailPluginId.value = pluginId
    selectedPluginId.value = pluginId
  }
  if (pluginId !== selectedPluginId.value) guardUnsavedSettings(open)
  else open()
}

function closePluginDetail(): void {
  guardUnsavedSettings(() => { detailPluginId.value = '' })
}

// 從面板外框直接跳到該插件的詳情頁（權限、設定、診斷）。
function openPluginDetailFromPanel(): void {
  const pluginId = panelViewPluginId.value
  closePluginPanelView()
  if (pluginId) openPluginDetail(pluginId)
}

// --- 快照與寵物清單 -------------------------------------------------------------

// 重新抓取快照。進行中又被呼叫時排成「結尾再抓一次」，而不是直接丟掉；
// silent 用於背景同步（例如切換啟用後更新崩潰狀態），不會讓整頁進入 loading。
const refreshPanel = createQueuedRefresh<{ silent?: boolean }>(async (options = {}) => {
  if (!options.silent) loading.value = true
  try {
    const result = await window.electronAPI?.getPluginPanelSnapshot()
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error, () => void refreshPanel())
      else setError('plugin_service_unavailable', () => void refreshPanel())
      return
    }
    snapshot.value = result.value
    catalogUrlDraft.value = result.value.preferences.catalogUrl
    const installedIds = new Set(result.value.plugins.map(plugin => plugin.id))
    if (!installedIds.has(selectedPluginId.value)) selectedPluginId.value = ''
    if (detailPluginId.value && !installedIds.has(detailPluginId.value)) detailPluginId.value = ''
    await refreshNotifications()
  } catch {
    setError('plugin_service_unavailable')
  } finally {
    if (!options.silent) loading.value = false
  }
}, { silent: true })

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

// --- 指令 ---------------------------------------------------------------------

function commandOf(plugin: PluginPanelPlugin, commandId: string) {
  return plugin.manifest?.contributes.commands?.find(command => command.id === commandId) ?? { title: { 'zh-TW': commandId, 'en-US': commandId } }
}

function commandTitle(command: { title: PluginLocalizedText }): string {
  return command.title[locale.value]
}

async function invokePluginCommand(commandId: string): Promise<void> {
  const plugin = selectedPlugin.value
  if (!plugin || invokingCommandId.value) return
  invokingCommandId.value = commandId
  try {
    const result = await window.electronAPI?.invokePluginCommand(plugin.id, commandId)
    if (!result?.ok) {
      setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
      return
    }
    setStatus(t('plugins.commandSentNamed', { command: commandTitle(commandOf(plugin, commandId)), name: pluginName(plugin) }))
  } catch {
    setError('plugin_action_failed')
  } finally {
    invokingCommandId.value = ''
  }
}

// --- 全域偏好與 catalog --------------------------------------------------------

function resetCatalog(): void {
  catalogItems.value = []
  catalogCheckComplete.value = false
  catalogLoadedAt.value = null
}

// 全域偏好以串行佇列送出：連續修改（例如多個欄位）依序生效，不會被「忙碌」丟棄。
// 成功後直接採用主行程回傳的偏好，不再整頁重新抓取。
async function updateGlobalPreferences(patch: PluginGlobalPreferencesPatch): Promise<void> {
  await enqueueSerial('global', async () => {
    const previousCatalogUrl = snapshot.value?.preferences.catalogUrl
    const stoppedCount = patch.pluginsEnabled === false && enabledGlobally.value
      ? plugins.value.filter(plugin => plugin.preference.enabled).length
      : 0
    setBusy('global', true)
    try {
      const result = await window.electronAPI?.setPluginGlobalPreferences(patch)
      if (!result?.ok) {
        if (result && !result.ok) setError(result.error)
        return
      }
      if (snapshot.value) mergePreferencesResult(snapshot.value, result.value)
      catalogUrlDraft.value = result.value.catalogUrl
      if (patch.pluginsEnabled === false && stoppedCount > 0) {
        notifier.notify({
          tone: 'success',
          text: t('plugins.globalStopped', { count: stoppedCount }),
          durationMs: 6000,
          action: { label: t('plugins.undo'), run: () => void updateGlobalPreferences({ pluginsEnabled: true }) },
        })
      }
      if (patch.onlineCatalogEnabled === false
        || (patch.catalogUrl !== undefined && patch.catalogUrl !== previousCatalogUrl)) {
        resetCatalog()
      }
    } catch {
      setError('plugin_action_failed')
    } finally {
      setBusy('global', false)
    }
  })
}

async function saveCatalogUrl(): Promise<void> {
  const previousUrl = snapshot.value?.preferences.catalogUrl ?? ''
  await updateGlobalPreferences({ catalogUrl: catalogUrlDraft.value })
  if (previousUrl !== snapshot.value?.preferences.catalogUrl) resetCatalog()
}

async function restoreCatalogUrl(): Promise<void> {
  catalogUrlDraft.value = DEFAULT_PLUGIN_CATALOG_URL
  await saveCatalogUrl()
}

// 目錄載入失敗以 inline 錯誤 + 重試呈現（catalogError），不再只丟 Toast。
// silent：自動載入（進入探索分頁、背景同步）不顯示成功訊息。
async function loadPluginCatalog(options: { silent?: boolean } = {}): Promise<void> {
  const scope = 'catalog'
  if (isBusy(scope) || !onlineCatalogEnabled.value) return
  setBusy(scope, true)
  catalogError.value = ''
  try {
    const result = await window.electronAPI?.listPluginCatalog()
    if (!result?.ok) {
      catalogError.value = result && !result.ok ? result.error : 'catalog_unavailable'
      return
    }
    catalogItems.value = result.value
    catalogCheckComplete.value = true
    catalogLoadedAt.value = Date.now()
    if (!options.silent) {
      setStatus(t('pluginCatalogChecked', {
        entries: String(result.value.length),
        updates: String(result.value.filter(item => item.updateAvailable).length),
      }))
    }
  } catch {
    catalogError.value = 'catalog_unavailable'
  } finally {
    setBusy(scope, false)
  }
}

// 進入探索分頁時：目錄已啟用且尚未載入才自動載入一次（已載入的結果沿用，使用者可手動重新檢查）。
async function ensureCatalogLoaded(): Promise<void> {
  if (!onlineCatalogEnabled.value || catalogLoadedAt.value !== null || isBusy('catalog')) return
  await loadPluginCatalog({ silent: true })
}

// 「全部更新」：逐一為每個可更新項目產生安裝計畫並開啟同一個確認 Sheet，絕不跳過同意。
async function installNextQueuedUpdate(): Promise<void> {
  const next = updateQueue.value[0]
  if (!next) return
  updateQueue.value = updateQueue.value.slice(1)
  await installCatalogPlugin(next)
}

async function updateAllCatalogPlugins(): Promise<void> {
  if (pendingPlan.value) return
  updateQueue.value = catalogItems.value.filter(item => item.updateAvailable)
  await installNextQueuedUpdate()
}

function catalogItemFor(pluginId: string): PluginCatalogPanelItem | undefined {
  return catalogById.value.get(pluginId)
}

async function installCatalogPlugin(item: PluginCatalogPanelItem): Promise<void> {
  const scope = 'install'
  if (isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.installPluginFromCatalog(item.plugin.id, item.latestVersion.version)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingPlan.value = result.value
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

// --- 回報問題 -----------------------------------------------------------------

// 回報問題先預覽會帶出的資訊，使用者確認後才開啟瀏覽器。
function requestReport(pluginId: string): void {
  pendingReportPluginId.value = pluginId
}

async function confirmReport(): Promise<void> {
  const pluginId = pendingReportPluginId.value
  pendingReportPluginId.value = ''
  if (pluginId) await reportPluginIssue(pluginId)
}

async function reportPluginIssue(pluginId: string): Promise<void> {
  const scope = pluginScope(pluginId)
  if (isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.reportInstalledPluginIssue(pluginId)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    setStatus(t('pluginReportOpened'))
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

// --- 資源上限與單一插件偏好 -------------------------------------------------------

function updateResourceLimit(key: keyof PluginResourceLimits, raw: string): void {
  const field = resourceFields.find(item => item.key === key)
  const value = resourceValueFromInput(key, Number(raw))
  if (!field || !Number.isSafeInteger(value) || value < field.min || value > field.max) {
    if (field) {
      notifier.notify({ tone: 'error', text: t('pluginResourceRangeInvalid', { min: String(field.min), max: String(field.max) }) })
    }
    return
  }
  void updateGlobalPreferences({ resources: { [key]: value } })
}

// 單一插件的偏好採樂觀更新：先改畫面，失敗再回滾該欄位並顯示錯誤；同一插件的變更依序送出。
async function updatePluginPreference(pluginId: string, patch: PluginPreferencePatch): Promise<void> {
  const current = snapshot.value
  if (!current) return
  const previous = applyPreferencePatch(current, pluginId, patch)
  const scope = pluginScope(pluginId)
  setBusy(scope, true)
  try {
    await enqueueSerial(scope, async () => {
      try {
        const result = await window.electronAPI?.setPluginInstancePreferences(pluginId, patch)
        if (!result?.ok) {
          if (snapshot.value) rollbackPreferencePatch(snapshot.value, pluginId, previous)
          setError(result && !result.ok ? result.error : 'plugin_service_unavailable')
          return
        }
        if (snapshot.value) mergePreferencesResult(snapshot.value, result.value)
        if (patch.enabled !== undefined) void refreshPanel({ silent: true })
      } catch {
        if (snapshot.value) rollbackPreferencePatch(snapshot.value, pluginId, previous)
        setError('plugin_action_failed')
      }
    })
  } finally {
    setBusy(scope, false)
  }
}

async function updatePluginRate(pluginId: string, raw: string): Promise<void> {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 30) {
    notifier.notify({ tone: 'error', text: t('pluginPerPluginRateRange') })
    return
  }
  await updatePluginPreference(pluginId, { rateLimitPer10Min: value })
}

async function updatePluginTarget(pluginId: string, targetPetId: string): Promise<void> {
  await updatePluginPreference(pluginId, { targetPetId: targetPetId || null })
}

// 撤銷主機授權：立即生效，並以 5 秒內可復原的 Toast 取代確認對話框；
// 之後插件再要連線時會重新詢問使用者。
async function revokeGrantedHost(plugin: PluginPanelPlugin, host: string): Promise<void> {
  const previous = [...plugin.preference.grantedHosts]
  await updatePluginPreference(plugin.id, {
    grantedHosts: previous.filter(item => item !== host),
  })
  if (plugin.preference.grantedHosts.includes(host)) return
  notifier.notify({
    tone: 'success',
    text: t('plugins.hostRevoked', { host }),
    durationMs: 5000,
    action: { label: t('plugins.undo'), run: () => void updatePluginPreference(plugin.id, { grantedHosts: previous }) },
  })
}

// --- 安裝與移除 ---------------------------------------------------------------

async function selectArchive(): Promise<void> {
  const scope = 'install'
  if (isBusy(scope)) return
  setBusy(scope, true)
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginArchive()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error)
      return
    }
    pendingPlan.value = result.value
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

async function selectDeveloperFolder(): Promise<void> {
  const scope = 'install'
  if (isBusy(scope)) return
  setBusy(scope, true)
  pendingPlan.value = null
  try {
    const result = await window.electronAPI?.selectPluginFolder()
    if (!result?.ok) {
      if (result && !result.ok && !result.cancelled) setError(result.error, undefined, result.diagnostic)
      return
    }
    pendingPlan.value = result.value
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

const PLAN_KIND_LABELS = {
  new: 'pluginInstallNew',
  update: 'pluginInstallUpdate',
  downgrade: 'pluginInstallDowngrade',
  reinstall: 'pluginInstallReinstall',
  incompatible: 'pluginIncompatible',
} as const satisfies Record<PluginInstallPlan['kind'], TranslationKey>

function planKindLabel(plan: PluginInstallPlan): string {
  return t(PLAN_KIND_LABELS[plan.kind])
}

// 更新時：新增權限單獨置頂，既有權限折疊；新安裝時所有權限都是「新增」。
const pendingPermissionSections = computed(() => {
  const plan = pendingPlan.value
  if (!plan) return { isUpdate: false, added: [] as PermissionGroupView[], existing: [] as PermissionGroupView[], existingCount: 0 }
  const units = permissionUnitsOfPlan(plan)
  const isUpdate = plan.requiresReconsent && plan.addedPermissions.length > 0
  if (!isUpdate) return { isUpdate: false, added: toPermissionGroupViews(units), existing: [], existingCount: 0 }
  const added = new Set(plan.addedPermissions)
  const existingUnits = units.filter(unit => !added.has(unit))
  return {
    isUpdate: true,
    added: toPermissionGroupViews(plan.addedPermissions),
    existing: toPermissionGroupViews(existingUnits),
    existingCount: existingUnits.length,
  }
})
const installAcknowledgements = computed(() => installAcknowledgementReasons(pendingPlan.value))

async function confirmInstall(): Promise<void> {
  const plan = pendingPlan.value
  const scope = 'install'
  if (!plan || plan.kind === 'incompatible' || isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.installPluginPlan(
      plan.token,
      plan.requiresReconsent,
      plan.requiresSignatureConfirmation === true,
    )
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingPlan.value = null
    if (catalogLoadedAt.value) void loadPluginCatalog({ silent: true })
    const installed = result.value
    setStatus(
      enabledGlobally.value
        ? t('pluginInstallSucceeded', { name: pluginName(installed) })
        : t('plugins.installSucceededGlobalOff', { name: pluginName(installed) }),
      { label: t(enabledGlobally.value ? 'plugins.enableNow' : 'plugins.enableAll'), run: () => void enableInstalledPlugin(installed.id) },
    )
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

// 安裝成功 Toast 的「立即啟用」：全域關閉時一併開啟全域開關。
async function enableInstalledPlugin(pluginId: string): Promise<void> {
  if (!enabledGlobally.value) await updateGlobalPreferences({ pluginsEnabled: true })
  await updatePluginPreference(pluginId, { enabled: true })
}

function requestRemove(plugin: PluginPanelPlugin): void {
  pendingRemove.value = plugin
  keepData.value = true
}

async function confirmRemove(): Promise<void> {
  const plugin = pendingRemove.value
  const scope = pluginScope(plugin?.id ?? '')
  if (!plugin || isBusy(scope)) return
  setBusy(scope, true)
  try {
    const result = await window.electronAPI?.removeInstalledPlugin(plugin.id, keepData.value)
    if (!result?.ok) {
      if (result && !result.ok) setError(result.error)
      return
    }
    pendingRemove.value = null
    setStatus(t('pluginRemoveSucceeded'))
    await refreshPanel()
  } catch {
    setError('plugin_action_failed')
  } finally {
    setBusy(scope, false)
  }
}

// --- 跨功能的監聽與生命週期 ------------------------------------------------------

watch(pendingPlan, plan => {
  if (!plan && updateQueue.value.length) void installNextQueuedUpdate()
})

watch(selectedPluginId, pluginId => {
  if (panelViewPluginId.value && panelViewPluginId.value !== pluginId) closePluginPanelView()
  void refreshDiagnostics(pluginId)
  void refreshPluginSettings(pluginId)
})

// 面板開啟請求只消費一次：以請求序號判斷，重新掛載或重新整理都不會把已關閉的面板再開一次。
function consumePanelRequest(): void {
  const nonce = props.requestNonce ?? 0
  if (nonce <= consumedPanelRequestNonce) return
  consumedPanelRequestNonce = nonce
  const pluginId = props.requestedPluginId
  if (!pluginId) {
    if (panelViewPluginId.value) closePluginPanelView()
    return
  }
  if (pluginsById.value.has(pluginId)) void openPluginPanelView(pluginId)
}

watch(() => [props.requestedPluginId, props.requestNonce] as const, consumePanelRequest)

// 此面板已掛載時才發出的詳細頁請求（例如從搜尋觸發 Appearance 卡片的
// "Open plugin settings"）在這裡處理。
watch(pluginDetailRequestNonce, () => {
  if (!snapshot.value) return
  const detailRequest = takePluginDetailRequest()
  if (detailRequest) openPluginDetail(detailRequest.pluginId, detailRequest.section)
})

onMounted(() => {
  void refreshPanel().then(() => {
    if (dailyUpdateCheck.value) void ensureCatalogLoaded()
    consumePanelRequest()
    // 從儀表板的插件分頁開啟：直接跳到該插件的詳情頁。
    const detailRequest = takePluginDetailRequest()
    if (detailRequest) openPluginDetail(detailRequest.pluginId, detailRequest.section)
  })
  void loadPetOptions()
  void window.electronAPI?.getPluginBadges?.().then(badges => { liveBadges.value = badges }).catch(() => {})
  removeBadgesListener = window.electronAPI?.onPluginBadgesChanged?.(badges => { liveBadges.value = badges }) ?? null
  void window.electronAPI?.getPluginEventSourceStatuses?.().then(statuses => { eventSourceStatuses.value = statuses }).catch(() => {})
  removeEventSourceListener = window.electronAPI?.onPluginEventSourceChanged?.(statuses => { eventSourceStatuses.value = statuses }) ?? null
})

onUnmounted(() => {
  notifier.dispose()
  removeBadgesListener?.()
  removeEventSourceListener?.()
})

  return {
    snapshot,
    notifications,
    visibleNotifications,
    liveBadges,
    eventSourceStatuses,
    markAllNotificationsRead,
    logs,
    diagnostics,
    petOptions,
    pluginSettings,
    settingsDraft,
    secretDrafts,
    selectedPluginId,
    settingsErrors,
    settingsDirty,
    pendingLeave,
    pendingSecretRemoveKey,
    confirmDiscardSettings,
    resetSettingsDraft,
    resetSettingsToDefaults,
    removePluginSecret,
    detailPluginId,
    detailSection,
    detailPlugin,
    openPluginDetail,
    closePluginDetail,
    panelViewPluginId,
    panelViewOpenToken,
    panelViewFrame,
    panelViewContent,
    panelViewMaximized,
    panelViewError,
    reloadPluginPanelView,
    openPluginDetailFromPanel,
    busy,
    isBusy,
    pluginBusy,
    invokingCommandId,
    loading,
    toasts: notifier.toasts,
    dismissToast: notifier.dismiss,
    runToastAction: notifier.runAction,
    notify: notifier.notify,
    setStatus,
    pendingPlan,
    pendingRemove,
    pendingSecretConsentKey,
    catalogItems,
    catalogCheckComplete,
    catalogLoadedAt,
    catalogError,
    updateQueue,
    ensureCatalogLoaded,
    updateAllCatalogPlugins,
    catalogItemFor,
    catalogSearch,
    catalogUrlDraft,
    keepData,
    ...legacyInitialValues,
    plugins,
    selectedPlugin,
    panelViewPlugin,
    enabledGlobally,
    onlineCatalogEnabled,
    dailyUpdateCheck,
    filteredCatalogItems,
    installedSearch,
    installedFilter,
    filteredPlugins,
    hasCompatiblePlan,
    pendingPluginName,
    resourceFields,
    failedPluginIconIds,
    pendingPermissionSections,
    installAcknowledgements,
    pluginName,
    pluginIconUrl,
    hidePluginIcon,
    restoreCatalogUrl,
    displayFingerprint,
    readPluginPanelViewBounds,
    sendPluginPanelViewBounds,
    openPluginPanelView,
    closePluginPanelView,
    togglePluginPanelViewMaximized,
    handlePluginPanelViewClosed,
    pluginStatusLabel,
    pluginStatusTone,
    localizedError,
    setError,
    refreshNotifications,
    refreshPanel,
    loadPetOptions,
    refreshDiagnostics,
    refreshPluginSettings,
    commandTitle,
    invokePluginCommand,
    settingTitle,
    settingValue,
    updateSetting,
    savePluginSettings,
    savePluginSecret,
    confirmSecretConsent,
    updateGlobalPreferences,
    saveCatalogUrl,
    loadPluginCatalog,
    installCatalogPlugin,
    reportPluginIssue,
    pendingReportPluginId,
    requestReport,
    confirmReport,
    updateResourceLimit,
    resourceInputValue,
    resourceBoundText,
    updatePluginPreference,
    updatePluginRate,
    updatePluginTarget,
    revokeGrantedHost,
    selectArchive,
    selectDeveloperFolder,
    planKindLabel,
    permissionLabel,
    permissionHint,
    confirmInstall,
    requestRemove,
    confirmRemove,
    markNotificationRead,
    openNotificationLink,
    clearNotifications,
    notificationSource,
    notificationTime,
    diagnosticTime,
    diagnosticCodeLabel,
    diagnosticTechnical
  }
}
