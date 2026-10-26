import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { analyzeIpcInventory, renderIpcInventory } from '../scripts/generate-ipc-inventory.mjs'

const mainSource = readFileSync(path.resolve('electron/main.ts'), 'utf8')
const hostSource = readFileSync(path.resolve('electron/plugin-host-window.ts'), 'utf8')
const panelViewSource = readFileSync(path.resolve('electron/plugin-panel-view.ts'), 'utf8')
const pluginUiPreloadSource = readFileSync(path.resolve('electron/plugin-ui-preload.ts'), 'utf8')
const pluginUiBridgeSource = readFileSync(path.resolve('electron/plugin-panel-view-bridge.ts'), 'utf8')

test('IPC inventory matches main registrations, preload APIs, and sender guards', () => {
  const inventory = analyzeIpcInventory()
  assert.equal(inventory.rows.length, 83)
  assert.equal(inventory.dynamicRegistrationCount, 0)
  assert.deepEqual(inventory.missingPreloadChannels, [])
  assert.deepEqual(inventory.unregisteredPreloadChannels, [])
  assert.deepEqual(inventory.unguardedChannels, [])
  assert.deepEqual(inventory.missingTypes, [])
  assert.deepEqual(inventory.extraTypes, [])
  assert.equal(readFileSync(path.resolve('docs/security/ipc-inventory.md'), 'utf8'), renderIpcInventory())
  assert.match(pluginUiPreloadSource, /contextBridge\.exposeInMainWorld\('agentPetsPlugin', api\)/)
  assert.match(pluginUiBridgeSource, /export interface PluginPanelPublicApi/)
})

test('renderer windows and plugin views explicitly retain Electron security defaults', () => {
  assert.equal((mainSource.match(/new BrowserWindow\(/g) ?? []).length, 2)
  assert.equal((mainSource.match(/webSecurity:\s*true/g) ?? []).length, 2)
  assert.equal((mainSource.match(/contextIsolation:\s*true/g) ?? []).length, 2)
  assert.equal((mainSource.match(/sandbox:\s*true/g) ?? []).length, 2)
  assert.equal((mainSource.match(/nodeIntegration:\s*false/g) ?? []).length, 2)
  assert.match(mainSource, /secureRendererWindow\(petWindow\)/)
  assert.match(mainSource, /secureRendererWindow\(panelWindow\)/)

  assert.match(hostSource, /webSecurity:\s*true/)
  assert.match(hostSource, /contextIsolation:\s*true/)
  assert.match(hostSource, /sandbox:\s*true/)
  assert.match(hostSource, /nodeIntegration:\s*false/)
  assert.match(hostSource, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(hostSource, /will-navigate/)
  assert.match(hostSource, /will-redirect/)
  assert.match(hostSource, /will-attach-webview/)

  assert.match(panelViewSource, /webSecurity:\s*true/)
  assert.match(panelViewSource, /setPermissionRequestHandler\([^\n]+callback\(false\)/)
  assert.match(panelViewSource, /setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(panelViewSource, /will-download/)
  assert.match(panelViewSource, /will-navigate/)
  assert.match(panelViewSource, /will-redirect/)
  assert.match(panelViewSource, /will-attach-webview/)
})

test('every non-default Electron session rejects permission requests and checks', () => {
  const networkSessionStart = mainSource.indexOf("const pluginNetworkSession = session.fromPartition('plugin-network')")
  assert.notEqual(networkSessionStart, -1)
  const networkSession = mainSource.slice(networkSessionStart, networkSessionStart + 1_200)
  assert.match(networkSession, /setPermissionRequestHandler\([^\n]+callback\(false\)/)
  assert.match(networkSession, /setPermissionCheckHandler\(\(\) => false\)/)

  assert.match(hostSource, /pluginSession\.setPermissionRequestHandler\([^\n]+callback\(false\)/)
  assert.match(hostSource, /pluginSession\.setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(mainSource, /defaultSession\.setPermissionCheckHandler\(\(\) => false\)/)
  assert.match(mainSource, /defaultSession\.setPermissionRequestHandler\([\s\S]{0,150}callback\(false\)/)
})
