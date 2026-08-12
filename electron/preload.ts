import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { PermissionDecisionValue, PermissionRequestView } from '../src/types/permission'

contextBridge.exposeInMainWorld('electronAPI', {
  onAgentStatusEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('agent-status-event', handler)
    return () => {
      ipcRenderer.removeListener('agent-status-event', handler)
    }
  },

  startDrag: () => {
    ipcRenderer.send('pet-drag-start')
  },

  notifyDragEnd: () => {
    ipcRenderer.send('pet-drag-end')
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

  togglePanel: () => {
    ipcRenderer.send('panel-toggle')
  },

  resizePanel: (height: number) => {
    ipcRenderer.send('panel-resize', { height })
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

  testIntegration: (source: 'opencode-cli' | 'opencode-desktop' | 'codex' | 'claude' | 'claude-desktop') => {
    return ipcRenderer.invoke('test-integration', source)
  },

  installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => {
    return ipcRenderer.invoke('install-integrations', target)
  },

  uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => {
    return ipcRenderer.invoke('uninstall-integrations', target)
  },

  loadPets: () => {
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
