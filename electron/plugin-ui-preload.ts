import { IPC_CHANNELS } from './ipc/channels'
import { contextBridge, ipcRenderer } from 'electron'
import { createPluginPanelPublicApi } from './plugin-panel-view-bridge.ts'
import { PluginUserActivationGuard } from './plugin-user-activation.ts'
import { isPluginThemeSnapshot, PLUGIN_THEME_TOKENS, type PluginThemeSnapshot } from '../src/types/plugin-theme.ts'

for (const eventName of ['dragstart', 'dragenter', 'dragover', 'drop']) {
  window.addEventListener(eventName, event => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
}

const userActivation = new PluginUserActivationGuard()
for (const eventName of ['click', 'keydown'] as const) {
  window.addEventListener(eventName, event => {
    if (eventName === 'keydown') {
      if (event instanceof KeyboardEvent) userActivation.recordKeyboard(event)
      return
    }
    if (event instanceof MouseEvent) userActivation.recordClick(event)
  }, true)
}

function consumeUserActivation(): boolean {
  return userActivation.consume()
}

// 宿主把 `--ap-*` 寫在頁面根元素上（只用 style.setProperty，名稱與值都先過白名單），
// 插件用 var(--ap-*) 就能跟著設定面板的主題與淺色／深色即時變化。
let themeApplied = false
let pendingTheme: PluginThemeSnapshot | null = null
function applyThemeTokens(value: unknown): void {
  if (!isPluginThemeSnapshot(value)) return
  const root = document.documentElement
  if (!root) {
    // preload 可能早於 <html> 建立；等文件解析後再套用最新值。
    pendingTheme = value
    return
  }
  themeApplied = true
  for (const name of PLUGIN_THEME_TOKENS) root.style.setProperty(name, value.tokens[name])
}
document.addEventListener('DOMContentLoaded', () => {
  if (pendingTheme) applyThemeTokens(pendingTheme)
  pendingTheme = null
}, { once: true })
ipcRenderer.on(IPC_CHANNELS.pluginPanelThemeChanged, (_event, snapshot: unknown) => applyThemeTokens(snapshot))
void ipcRenderer.invoke(IPC_CHANNELS.pluginPanelApi, 'theme.get', []).then((response: unknown) => {
  // 推送比初始讀取先到時，推送的才是最新值。
  if (themeApplied || pendingTheme || !response || typeof response !== 'object') return
  const result = response as { ok?: unknown; value?: unknown }
  if (result.ok === true) applyThemeTokens(result.value)
}, () => {})

const api = createPluginPanelPublicApi({
  invoke: (method, args) => ipcRenderer.invoke(IPC_CHANNELS.pluginPanelApi, method, args),
  consumeUserActivation,
  onMessage: listener => {
    const handler = (_event: unknown, data: unknown) => listener(data)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelUiMessage, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelUiMessage, handler)
  },
  onThemeChange: listener => {
    const handler = (_event: unknown, snapshot: unknown) => listener(snapshot)
    ipcRenderer.on(IPC_CHANNELS.pluginPanelThemeChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginPanelThemeChanged, handler)
  },
})

contextBridge.exposeInMainWorld('agentPetsPlugin', api)
