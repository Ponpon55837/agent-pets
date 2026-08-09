import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onAgentStatusEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('agent-status-event', handler)
    return () => {
      ipcRenderer.removeListener('agent-status-event', handler)
    }
  },

  moveWindow: (dx: number, dy: number) => {
    ipcRenderer.send('pet-move', { dx, dy })
  },

  notifyDragEnd: () => {
    ipcRenderer.send('pet-drag-end')
  },

  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('pet-resize', { width, height })
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
