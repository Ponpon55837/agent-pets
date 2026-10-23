import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent, MessagePortMain } from 'electron'

type PluginHostPort = MessagePortMain

contextBridge.exposeInMainWorld('agentPetsPluginHost', Object.freeze({
  onPort(callback: (port: PluginHostPort) => void): () => void {
    const handler = (event: IpcRendererEvent) => {
      const port = event.ports[0]
      if (port) callback(port as unknown as PluginHostPort)
    }
    ipcRenderer.on('plugin-host-port', handler)
    return () => ipcRenderer.removeListener('plugin-host-port', handler)
  },
}))
