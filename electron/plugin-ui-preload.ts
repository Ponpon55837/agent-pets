import { contextBridge, ipcRenderer } from 'electron'
import { createPluginPanelPublicApi } from './plugin-panel-view-bridge.ts'

for (const eventName of ['dragstart', 'dragenter', 'dragover', 'drop']) {
  window.addEventListener(eventName, event => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
}

const api = createPluginPanelPublicApi({
  invoke: (method, args) => ipcRenderer.invoke('plugin-panel-api', method, args),
  onMessage: listener => {
    const handler = (_event: unknown, data: unknown) => listener(data)
    ipcRenderer.on('plugin-panel-ui-message', handler)
    return () => ipcRenderer.removeListener('plugin-panel-ui-message', handler)
  },
})

contextBridge.exposeInMainWorld('agentPetsPlugin', api)
