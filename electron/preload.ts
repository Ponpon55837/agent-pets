import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { PermissionDecisionValue, PermissionRequestView } from '../src/types/permission'
import type { ProgressionSnapshot } from '../src/types/progression'
import type { AchievementSnapshot, AchievementUnlock } from '../src/types/achievement'
import type { HistoryClearResult, HistoryCommandResult, HistorySummary } from '../src/types/history'
import type { PetWindowMode, PetWindowModeState } from '../src/types/pet-window'
import type { PetBehaviorManifest } from '../src/types/pet'
import type { PresentationIntent, PresentationStatusUpdate } from '../src/types/presentation'
import type {
  PluginBrokerDiagnostic,
  PluginBrokerLogEntry,
  PluginFeedItem,
  PluginGlobalPreferencesPatch,
  PluginInstallPlan,
  PluginNotificationRecord,
  PluginPanelPlugin,
  PluginPanelSettingsSnapshot,
  PluginPanelResult,
  PluginPanelSnapshot,
  PluginPreferences,
  PluginSettingScalar,
} from '../src/types/plugin.ts'
import type {
  ProjectMcpRegistrySnapshot,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from '../src/types/project-mcp'
import type { ProjectPetArchiveResult, ProjectPetCommandResult, ProjectPetView } from '../src/types/project-pet'
import type {
  AdapterDetection,
  AdapterRuntimeStatus,
  AgentAdapterId,
  DiagnosticReport,
} from '../src/types/agent-adapter'

contextBridge.exposeInMainWorld('electronAPI', {
  onAgentStatusEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('agent-status-event', handler)
    return () => {
      ipcRenderer.removeListener('agent-status-event', handler)
    }
  },
  onPresentationIntent: (callback: (intent: PresentationIntent) => void) => {
    const handler = (_event: unknown, intent: PresentationIntent) => callback(intent)
    ipcRenderer.on('presentation-intent', handler)
    return () => {
      ipcRenderer.removeListener('presentation-intent', handler)
    }
  },
  onPluginFeedItem: (callback: (item: PluginFeedItem) => void) => {
    const handler = (_event: unknown, item: PluginFeedItem) => callback(item)
    ipcRenderer.on('plugin-feed-item', handler)
    return () => {
      ipcRenderer.removeListener('plugin-feed-item', handler)
    }
  },
  onPluginFeedUnreadCount: (callback: (count: number) => void) => {
    const handler = (_event: unknown, count: number) => callback(count)
    ipcRenderer.on('plugin-feed-unread-count', handler)
    return () => {
      ipcRenderer.removeListener('plugin-feed-unread-count', handler)
    }
  },
  getPluginFeedUnreadCount: (): Promise<number> => ipcRenderer.invoke('plugin-feed-unread-count'),
  completePluginFeed: (itemId: string): Promise<boolean> => ipcRenderer.invoke('plugin-feed-complete', itemId),
  openPluginFeedLink: (itemId: string): Promise<boolean> => ipcRenderer.invoke('plugin-feed-open-link', itemId),
  getPluginPanelSnapshot: (): Promise<PluginPanelResult<PluginPanelSnapshot>> => ipcRenderer.invoke('plugin-panel-snapshot'),
  getPluginSettings: (pluginId: string): Promise<PluginPanelResult<PluginPanelSettingsSnapshot>> => ipcRenderer.invoke('plugin-settings-get', pluginId),
  setPluginSettings: (pluginId: string, value: Record<string, PluginSettingScalar>): Promise<PluginPanelResult<Record<string, PluginSettingScalar>>> => ipcRenderer.invoke('plugin-settings-set', pluginId, value),
  setPluginSecret: (pluginId: string, key: string, value: string): Promise<PluginPanelResult<{ configured: boolean }>> => ipcRenderer.invoke('plugin-secret-set', pluginId, key, value),
  setPluginGlobalPreferences: (patch: PluginGlobalPreferencesPatch): Promise<PluginPanelResult<PluginPreferences>> => ipcRenderer.invoke('plugin-preferences-global-set', patch),
  setPluginInstancePreferences: (pluginId: string, patch: unknown): Promise<PluginPanelResult<PluginPreferences>> => ipcRenderer.invoke('plugin-preferences-instance-set', pluginId, patch),
  selectPluginArchive: (): Promise<PluginPanelResult<PluginInstallPlan>> => ipcRenderer.invoke('plugin-install-select'),
  installPluginPlan: (token: string, acceptAdditionalPermissions: boolean): Promise<PluginPanelResult<PluginPanelPlugin>> => ipcRenderer.invoke('plugin-install-confirm', token, acceptAdditionalPermissions),
  removeInstalledPlugin: (pluginId: string, keepData: boolean): Promise<PluginPanelResult<{ removed: true; keptData: boolean }>> => ipcRenderer.invoke('plugin-remove', pluginId, keepData),
  getPluginDiagnostics: (pluginId: string): Promise<PluginPanelResult<{ logs: PluginBrokerLogEntry[]; diagnostics: PluginBrokerDiagnostic[] }>> => ipcRenderer.invoke('plugin-diagnostics', pluginId),
  listPluginNotifications: (): Promise<PluginPanelResult<PluginNotificationRecord[]>> => ipcRenderer.invoke('plugin-notifications-list'),
  markPluginNotificationRead: (itemId: string): Promise<PluginPanelResult<{ read: boolean }>> => ipcRenderer.invoke('plugin-notifications-read', itemId),
  clearPluginNotifications: (pluginId?: string): Promise<PluginPanelResult<{ removed: number }>> => ipcRenderer.invoke('plugin-notifications-clear', pluginId),
  onPluginNotificationsChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('plugin-notifications-changed', handler)
    return () => ipcRenderer.removeListener('plugin-notifications-changed', handler)
  },
  publishPresentationStatus: (snapshot: PresentationStatusUpdate) => {
    ipcRenderer.send('presentation-status-update', snapshot)
  },

  startDrag: () => {
    ipcRenderer.send('pet-drag-start')
  },

  notifyDragEnd: (moved: boolean) => {
    ipcRenderer.send('pet-drag-end', { moved })
  },

  notifyPetHover: () => {
    ipcRenderer.send('pet-window-hover')
  },

  shimejiWalkStep: (deltaX: number) => {
    if (!Number.isFinite(deltaX)) return
    ipcRenderer.send('shimeji-walk-step', { deltaX })
  },

  setPetWindowMode: (mode: PetWindowMode): Promise<PetWindowModeState> => {
    return ipcRenderer.invoke('pet-window-mode-set', mode)
  },

  initializePetWindowMode: (): Promise<PetWindowModeState> => {
    return ipcRenderer.invoke('pet-window-mode-init')
  },

  onPetWindowModeUpdated: (callback: (state: PetWindowModeState) => void) => {
    const handler = (_event: unknown, state: PetWindowModeState) => callback(state)
    ipcRenderer.on('pet-window-mode-updated', handler)
    return () => {
      ipcRenderer.removeListener('pet-window-mode-updated', handler)
    }
  },

  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('pet-resize', { width, height })
  },

  reportContentHeight: (height: number) => {
    ipcRenderer.send('pet-content-height', { height })
  },

  setMousePassthrough: (ignore: boolean) => {
    ipcRenderer.send('pet-mouse-passthrough', { ignore })
  },

  requestPetHide: () => {
    ipcRenderer.send('pet-hide-request')
  },

  togglePanel: () => {
    ipcRenderer.send('panel-toggle')
  },

  resizePanel: (height: number, width?: number) => {
    ipcRenderer.send('panel-resize', { height, ...(width === undefined ? {} : { width }) })
  },

  hidePanel: () => {
    ipcRenderer.send('panel-hide')
  },

  onPanelOpened: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('panel-opened', handler)
    return () => {
      ipcRenderer.removeListener('panel-opened', handler)
    }
  },

  onPanelOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('panel-open-settings', handler)
    return () => {
      ipcRenderer.removeListener('panel-open-settings', handler)
    }
  },

  initializeDesktopPreferences: (legacySoundEnabled: boolean): Promise<DesktopPreferences> => {
    return ipcRenderer.invoke('desktop-preferences-init', legacySoundEnabled)
  },

  setDesktopPreferences: (patch: DesktopPreferencesPatch): Promise<DesktopPreferences> => {
    return ipcRenderer.invoke('desktop-preferences-set', patch)
  },

  getPowerSaveState: (): Promise<boolean> => {
    return ipcRenderer.invoke('power-save-state')
  },

  onPowerSaveStateUpdated: (callback: (powerSave: boolean) => void) => {
    const handler = (_event: unknown, powerSave: boolean) => callback(powerSave)
    ipcRenderer.on('power-save-state-updated', handler)
    return () => {
      ipcRenderer.removeListener('power-save-state-updated', handler)
    }
  },

  initializeProgression: (petId?: string): Promise<ProgressionSnapshot | null> => {
    return ipcRenderer.invoke('progression-init', petId)
  },

  setProgressionPet: (petId: string): Promise<ProgressionSnapshot | null> => {
    return ipcRenderer.invoke('progression-set-pet', petId)
  },

  initializeAchievements: (petId?: string): Promise<AchievementSnapshot | null> => {
    return ipcRenderer.invoke('achievements-init', petId)
  },

  onAchievementsUpdated: (callback: (snapshot: AchievementSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: AchievementSnapshot) => callback(snapshot)
    ipcRenderer.on('achievements-updated', handler)
    return () => {
      ipcRenderer.removeListener('achievements-updated', handler)
    }
  },

  onAchievementUnlocked: (callback: (unlock: AchievementUnlock) => void) => {
    const handler = (_event: unknown, unlock: AchievementUnlock) => callback(unlock)
    ipcRenderer.on('achievement-unlocked', handler)
    return () => {
      ipcRenderer.removeListener('achievement-unlocked', handler)
    }
  },

  onProgressionUpdated: (callback: (snapshot: ProgressionSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: ProgressionSnapshot) => callback(snapshot)
    ipcRenderer.on('progression-updated', handler)
    return () => {
      ipcRenderer.removeListener('progression-updated', handler)
    }
  },

  onDesktopPreferencesUpdated: (callback: (preferences: DesktopPreferences) => void) => {
    const handler = (_event: unknown, preferences: DesktopPreferences) => callback(preferences)
    ipcRenderer.on('desktop-preferences-updated', handler)
    return () => {
      ipcRenderer.removeListener('desktop-preferences-updated', handler)
    }
  },

  initializePermissionRequests: (): Promise<PermissionRequestView[]> => {
    return ipcRenderer.invoke('permission-requests-init')
  },

  onPermissionRequestsUpdated: (callback: (requests: PermissionRequestView[]) => void) => {
    const handler = (_event: unknown, requests: PermissionRequestView[]) => callback(requests)
    ipcRenderer.on('permission-requests-updated', handler)
    return () => {
      ipcRenderer.removeListener('permission-requests-updated', handler)
    }
  },

  decidePermission: (requestId: string, decision: PermissionDecisionValue) => {
    return ipcRenderer.invoke('permission-decide', { requestId, decision })
  },

  quitApp: () => {
    ipcRenderer.send('pet-quit')
  },

  restartApp: () => {
    ipcRenderer.send('pet-restart')
  },

  checkIntegration: () => {
    return ipcRenderer.invoke('integration-status')
  },

  diagnoseAdapter: (id: AgentAdapterId): Promise<{
    ok: boolean
    report?: DiagnosticReport
    error?: string
  }> => {
    return ipcRenderer.invoke('adapter-diagnose', id)
  },

  installAdapter: (id: AgentAdapterId): Promise<{
    ok: boolean
    status?: AdapterDetection
    error?: string
  }> => {
    return ipcRenderer.invoke('adapter-install', id)
  },

  uninstallAdapter: (id: AgentAdapterId): Promise<{
    ok: boolean
    status?: AdapterDetection
    error?: string
  }> => {
    return ipcRenderer.invoke('adapter-uninstall', id)
  },

  getQuotaUsage: (force = false) => {
    return ipcRenderer.invoke('quota-usage', force)
  },

  onQuotaUsageUpdated: (callback: (usage: unknown) => void) => {
    const handler = (_event: unknown, usage: unknown) => callback(usage)
    ipcRenderer.on('quota-usage-updated', handler)
    return () => {
      ipcRenderer.removeListener('quota-usage-updated', handler)
    }
  },

  getHistorySummary: (projectId?: string): Promise<HistorySummary | null> => {
    return ipcRenderer.invoke('history-summary', projectId)
  },

  listProjectPets: (): Promise<ProjectPetView[]> => {
    return ipcRenderer.invoke('project-pets-list')
  },

  pickProjectPet: (): Promise<ProjectPetCommandResult> => {
    return ipcRenderer.invoke('project-pets-pick')
  },

  setProjectPetBinding: (projectId: string, petId: string | null): Promise<ProjectPetCommandResult> => {
    return ipcRenderer.invoke('project-pets-bind', { projectId, petId })
  },

  archiveProjectPet: (projectId: string): Promise<ProjectPetArchiveResult> => {
    return ipcRenderer.invoke('project-pets-archive', projectId)
  },

  getProjectPetsEnabled: (): Promise<boolean> => {
    return ipcRenderer.invoke('project-pets-get-enabled')
  },

  setProjectPetsEnabled: (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('project-pets-set-enabled', enabled)
  },

  clearHistory: (): Promise<HistoryClearResult> => {
    return ipcRenderer.invoke('history-clear')
  },

  exportHistory: (): Promise<HistoryCommandResult> => {
    return ipcRenderer.invoke('history-export')
  },

  onHistoryUpdated: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('history-updated', handler)
    return () => {
      ipcRenderer.removeListener('history-updated', handler)
    }
  },

  testIntegration: (source: 'opencode-cli' | 'opencode-desktop' | 'codex' | 'codex-desktop' | 'claude' | 'claude-desktop') => {
    return ipcRenderer.invoke('test-integration', source)
  },

  installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => {
    return ipcRenderer.invoke('install-integrations', target)
  },

  setupProjectMcp: (): Promise<ProjectMcpSetupSummary> => {
    return ipcRenderer.invoke('project-mcp-setup')
  },

  listProjectMcp: (): Promise<ProjectMcpRegistrySnapshot> => {
    return ipcRenderer.invoke('project-mcp-list')
  },

  removeProjectMcp: (projectPath: string): Promise<ProjectMcpRemovalSummary> => {
    return ipcRenderer.invoke('project-mcp-remove', projectPath)
  },

  forgetProjectMcp: (projectPath: string): Promise<{ ok: boolean; removed: boolean; error?: string }> => {
    return ipcRenderer.invoke('project-mcp-forget', projectPath)
  },

  uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => {
    return ipcRenderer.invoke('uninstall-integrations', target)
  },

  loadPets: (): Promise<Array<{
    id: string
    displayName: string
    folder: string
    builtIn: boolean
    behaviorManifest?: PetBehaviorManifest
  }>> => {
    return ipcRenderer.invoke('load-pets')
  },

  addCustomPet: (petData: { id: string; displayName: string }) => {
    return ipcRenderer.invoke('add-custom-pet', petData)
  },

  renameCustomPet: (petId: string, newName: string) => {
    return ipcRenderer.invoke('rename-custom-pet', petId, newName)
  },

  removeCustomPet: (petId: string) => {
    return ipcRenderer.invoke('remove-custom-pet', petId)
  },

  getCustomPetSprite: (petId: string) => {
    return ipcRenderer.invoke('get-custom-pet-sprite', petId)
  },

  importPetSprite: (petId: string, displayName: string) => {
    return ipcRenderer.invoke('import-pet-sprite', petId, displayName)
  },

  importPetZip: () => {
    return ipcRenderer.invoke('import-pet-zip')
  },
})
