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

  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('pet-resize', { width, height })
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

  checkIntegration: () => {
    return ipcRenderer.invoke('integration-status')
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
})
