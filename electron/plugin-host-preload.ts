import { ipcRenderer } from 'electron'

ipcRenderer.on('plugin-host-port', event => {
  const port = event.ports[0]
  if (!port) return
  window.postMessage('agent-pets-plugin-host-port', window.location.origin, [port])
})
