import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { PluginRegistry } from '../electron/plugin-registry.ts'
import { grantedPermissionUnits as permissionUnits } from '../src/utils/plugin-permission-units.ts'
import { groupPermissionUnits, permissionUnitsOfPlan } from '../src/utils/plugin-permissions.ts'
import { PLUGIN_CONTRIBUTION_REGISTRY } from '../src/types/plugin.ts'
import type { PluginManifest } from '../src/types/plugin.ts'
import { removeTempTree } from './support/temp-dir.mts'

// 這些期望值是 1.12.5 的主行程 permissionUnits() 與畫面 permissionUnitsOfPlan() 的實際輸出，
// 在抽取共用產生器之前先執行通過。主行程的結果會寫進 registry.json 的 grantedPermissions.units，
// 並決定更新時是否需要重新同意，所以任何字串、排序或去重的變化都是授權變更。

type Source = Pick<PluginManifest, 'permissions' | 'contributes'>

const title = { 'zh-TW': 'x', 'en-US': 'x' }

const FULL: Source = {
  permissions: {
    network: { hosts: ['b.example', 'a.example'], userGranted: true },
    links: { hosts: ['docs.example'] },
    secrets: ['token', 'apiKey'],
    schedule: { minIntervalSec: 60 },
    storage: true,
    agentStatus: true,
  },
  contributes: {
    feed: true,
    reaction: true,
    settings: { fields: [] } as never,
    panelView: { entry: 'panel/index.html', title } as never,
    commands: [{ id: 'one', title }, { id: 'two', title }] as never,
    tray: { commands: ['one'] },
    badge: true,
    skins: [{}, {}, {}] as never,
    eventSource: { family: 'build', displayName: title } as never,
    panelThemes: [{ fonts: [] }, { fonts: [{}] }] as never,
  },
}

const FULL_DISPLAY_ORDER = [
  'network:b.example', 'network:a.example', 'network:userGranted', 'links:docs.example',
  'storage', 'agentStatus', 'schedule', 'secrets:token', 'secrets:apiKey',
  'contributes:feed', 'contributes:reaction', 'contributes:panelView', 'contributes:commands', 'contributes:tray',
  'contributes:badge', 'contributes:skins:3', 'contributes:eventSource', 'contributes:panelThemes:2', 'contributes:panelThemeFonts',
]

const FULL_REGISTRY_ORDER = [
  'agentStatus',
  'contributes:badge', 'contributes:commands', 'contributes:eventSource', 'contributes:feed', 'contributes:panelThemeFonts',
  'contributes:panelThemes:2', 'contributes:panelView', 'contributes:reaction', 'contributes:skins:3', 'contributes:tray',
  'links:docs.example', 'network:a.example', 'network:b.example', 'network:userGranted',
  'schedule', 'secrets:apiKey', 'secrets:token', 'storage',
]

const CASES: Array<{ name: string; source: Source; display: string[]; registry: string[] }> = [
  { name: 'every permission and contribution', source: FULL, display: FULL_DISPLAY_ORDER, registry: FULL_REGISTRY_ORDER },
  { name: 'nothing requested', source: { permissions: {}, contributes: {} }, display: [], registry: [] },
  {
    name: 'false flags, empty lists and settings add no unit',
    source: {
      permissions: { network: { hosts: ['a.example'], userGranted: false }, storage: false, agentStatus: false, secrets: [] },
      contributes: {
        feed: false, reaction: false, badge: false, commands: [], tray: { commands: [] }, skins: [], panelThemes: [],
        settings: { fields: [] } as never,
      },
    },
    display: ['network:a.example'],
    registry: ['network:a.example'],
  },
  {
    name: 'panel themes without fonts do not ask for fonts',
    source: { permissions: {}, contributes: { panelThemes: [{ fonts: [] }] as never } },
    display: ['contributes:panelThemes:1'],
    registry: ['contributes:panelThemes:1'],
  },
  {
    name: 'manifest key order does not change the registry order',
    source: {
      permissions: { agentStatus: true, secrets: ['z'], storage: true, links: { hosts: ['l.example'] }, network: { hosts: ['n.example'] } },
      contributes: { eventSource: { family: 'x', displayName: title } as never, feed: true },
    },
    display: ['network:n.example', 'links:l.example', 'storage', 'agentStatus', 'secrets:z', 'contributes:feed', 'contributes:eventSource'],
    registry: ['agentStatus', 'contributes:eventSource', 'contributes:feed', 'links:l.example', 'network:n.example', 'secrets:z', 'storage'],
  },
]

for (const { name, source, display, registry } of CASES) {
  test(`registry permission units: ${name}`, () => {
    assert.deepEqual(permissionUnits(source as PluginManifest), registry)
  })
  test(`install screen permission units: ${name}`, () => {
    assert.deepEqual(permissionUnitsOfPlan(source), display)
  })
  test(`install screen shows exactly the units the registry grants: ${name}`, () => {
    assert.deepEqual([...new Set(permissionUnitsOfPlan(source))].sort(), permissionUnits(source as PluginManifest))
  })
}

test('the registry collapses duplicate units into one grant', () => {
  const source = {
    permissions: { network: { hosts: ['a.example', 'a.example'] }, secrets: ['t', 't'] },
    contributes: {},
  } as Source
  assert.deepEqual(permissionUnits(source as PluginManifest), ['network:a.example', 'secrets:t'])
})

// main 對 manifest 形狀以外的值採保守處理：任何為 true 的權限鍵都成為一個單位，讓未來新增的權限
// 一定進入授權清單與更新差異，而不是被悄悄略過。
test('the registry turns any other true permission key into its own unit', () => {
  const source = { permissions: { teleport: true, network: true, quiet: false }, contributes: {} } as unknown as PluginManifest
  assert.deepEqual(permissionUnits(source), ['network', 'teleport'])
  // 畫面跟著列出同一批單位：未知的鍵顯示成高風險的「未知權限」，不會被略過。
  const shown = groupPermissionUnits(permissionUnitsOfPlan(source)).flatMap(group => group.entries)
  assert.deepEqual(shown.map(entry => [entry.unit, entry.risk, entry.known]), [['network', 'high', true], ['teleport', 'high', false]])
})

function withUserData(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-permission-units-'))
  try { run(directory) } finally { removeTempTree(directory) }
}

function archive(version: string, permissions: Record<string, unknown>, contributes: Record<string, unknown>): Uint8Array {
  const manifest = {
    id: 'units-plugin', name: { 'zh-TW': '權限', 'en-US': 'Units' }, version, apiVersion: '1', author: 'Test',
    entry: 'dist/main.js', permissions, contributes,
  }
  return zipSync({ 'plugin.json': strToU8(JSON.stringify(manifest)), 'dist/main.js': strToU8('export default {}') })
}

function plan(registry: PluginRegistry, data: Uint8Array) {
  const result = registry.planInstall(data)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

test('install grants, update diffs and reconsent follow the registry units', () => {
  withUserData((userData) => {
    const registry = new PluginRegistry(userData)
    const first = plan(registry, archive('1.0.0', { storage: true, network: { hosts: ['b.example', 'a.example'] } }, { feed: true }))
    assert.deepEqual(first.addedPermissions, ['contributes:feed', 'network:a.example', 'network:b.example', 'storage'])
    assert.equal(first.requiresReconsent, false)
    assert.equal(registry.install(first.token).ok, true)
    const stored = JSON.parse(fs.readFileSync(path.join(userData, 'plugins', 'registry.json'), 'utf8')) as {
      plugins: Record<string, { grantedPermissions: { units: string[] } }>
    }
    assert.deepEqual(stored.plugins['units-plugin'].grantedPermissions.units, ['contributes:feed', 'network:a.example', 'network:b.example', 'storage'])

    const same = plan(registry, archive('1.1.0', { network: { hosts: ['a.example', 'b.example'] }, storage: true }, { feed: true }))
    assert.deepEqual(same.addedPermissions, [])
    assert.equal(same.requiresReconsent, false)

    const more = plan(registry, archive('1.2.0', {
      storage: true, agentStatus: true, network: { hosts: ['a.example', 'b.example'], userGranted: true },
      links: { hosts: ['docs.example'] }, secrets: ['token'], schedule: { minIntervalSec: 60 },
    }, { feed: true, reaction: true, badge: true }))
    assert.deepEqual(more.addedPermissions, [
      'agentStatus', 'contributes:badge', 'contributes:reaction', 'links:docs.example', 'network:userGranted', 'schedule', 'secrets:token',
    ])
    assert.equal(more.requiresReconsent, true)
    assert.deepEqual(registry.install(more.token), { ok: false, error: 'permission_reconsent_required' })

    const fewer = plan(registry, archive('1.3.0', { storage: true }, {}))
    assert.deepEqual(fewer.addedPermissions, [])
    assert.equal(fewer.requiresReconsent, false)
  })
})

// 安裝畫面的分組與風險（依 1.12.5 輸出固定）。共用產生器只產生單位字串，分級仍是畫面自己的規則。
test('the install screen groups every unit with its 1.12.5 risk', () => {
  const groups = groupPermissionUnits(permissionUnitsOfPlan(FULL)).map(group => ({
    id: group.id, risk: group.risk, entries: group.entries.map(entry => `${entry.unit}|${entry.risk}|${entry.known}`),
  }))
  assert.deepEqual(groups, [
    { id: 'network', risk: 'high', entries: ['network:b.example|high|true', 'network:a.example|high|true', 'network:userGranted|high|true', 'links:docs.example|high|true'] },
    { id: 'data', risk: 'high', entries: ['secrets:token|high|true', 'secrets:apiKey|high|true', 'storage|medium|true', 'agentStatus|medium|true', 'schedule|medium|true'] },
    {
      id: 'display', risk: 'medium', entries: [
        'contributes:panelThemeFonts|medium|true',
        'contributes:feed|low|true', 'contributes:reaction|low|true', 'contributes:panelView|low|true', 'contributes:commands|low|true',
        'contributes:tray|low|true', 'contributes:badge|low|true', 'contributes:skins:3|low|true', 'contributes:eventSource|low|true',
        'contributes:panelThemes:2|low|true',
      ],
    },
  ])
})

// 新增 contribution 時，這個 fixture 必須補上它，上面的期望值也要明確決定它的單位與風險。
test('the fixture covers every contribution in the registry', () => {
  assert.deepEqual(Object.keys(FULL.contributes).sort(), Object.keys(PLUGIN_CONTRIBUTION_REGISTRY).sort())
})
