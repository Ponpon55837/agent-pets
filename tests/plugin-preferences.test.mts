import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_PLUGIN_PREFERENCES,
  DEFAULT_PLUGIN_RESOURCES,
  PLUGIN_PREFERENCES_FILENAME,
  PLUGIN_PREFERENCES_MAX_BYTES,
  PLUGIN_RESOURCE_BOUNDS,
  PluginPreferencesStore,
} from '../electron/plugin-preferences.ts'

function withUserData(run: (userData: string) => void): void {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-preferences-'))
  try { run(userData) } finally { fs.rmSync(userData, { recursive: true, force: true }) }
}

test('plugin preferences use secure defaults and persist under userData atomically', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.deepEqual(store.get(), DEFAULT_PLUGIN_PREFERENCES)
    assert.deepEqual(store.getPlugin('sample'), {
      enabled: false,
      muted: false,
      rateLimitPer10Min: 5,
      targetPetId: null,
      grantedHosts: [],
    })

    const updated = store.updateGlobal({ pluginsEnabled: true, developerMode: true })
    store.updatePlugin('sample', {
      enabled: true,
      muted: true,
      rateLimitPer10Min: 12,
      targetPetId: 'pet-main',
      grantedHosts: ['api.example.com'],
    })

    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    assert.equal(fs.existsSync(filePath), true)
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600)
    assert.equal(updated.pluginsEnabled, true)

    const reopened = new PluginPreferencesStore(userData)
    assert.equal(reopened.get().pluginsEnabled, true)
    assert.equal(reopened.get().developerMode, true)
    assert.deepEqual(reopened.getPlugin('sample'), {
      enabled: true,
      muted: true,
      rateLimitPer10Min: 12,
      targetPetId: 'pet-main',
      grantedHosts: ['api.example.com'],
    })
  })
})

test('resource defaults match the plan and accept values only within each hard bound', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.deepEqual(store.get().resources, DEFAULT_PLUGIN_RESOURCES)
    assert.equal(Object.isFrozen(PLUGIN_RESOURCE_BOUNDS), true)
    assert.equal(Object.isFrozen(PLUGIN_RESOURCE_BOUNDS.maxEnabledPlugins), true)
    for (const [key, bounds] of Object.entries(PLUGIN_RESOURCE_BOUNDS)) {
      const field = key as keyof typeof PLUGIN_RESOURCE_BOUNDS
      const atMinimum = store.updateGlobal({ resources: { [field]: bounds.min } })
      assert.equal(atMinimum.resources[field], bounds.min)
      const atMaximum = store.updateGlobal({ resources: { [field]: bounds.max } })
      assert.equal(atMaximum.resources[field], bounds.max)
      assert.throws(() => store.updateGlobal({ resources: { [field]: bounds.min - 1 } }), TypeError)
      assert.throws(() => store.updateGlobal({ resources: { [field]: bounds.max + 1 } }), TypeError)
      assert.throws(() => store.updateGlobal({ resources: { [field]: bounds.default + 0.5 } }), TypeError)
    }
    assert.equal(store.get().resources.maxEnabledPlugins, PLUGIN_RESOURCE_BOUNDS.maxEnabledPlugins.max)
  })
})

test('global and per-plugin patches reject unknown fields and invalid types', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.throws(() => store.updateGlobal({ unknown: true }), /Unsupported plugin preference/)
    assert.throws(() => store.updateGlobal({ pluginsEnabled: 'yes' }), /must be boolean/)
    assert.throws(() => store.updateGlobal({ resources: { surprise: 1 } }), /hard bounds/)
    assert.throws(() => store.updatePlugin('sample', { enabled: 1 }), /must be boolean/)
    assert.throws(() => store.updatePlugin('sample', { unknown: true }), /Unsupported per-plugin preference/)
    assert.throws(() => store.updatePlugin('sample', { rateLimitPer10Min: 0 }), /from 1 to 30/)
    assert.throws(() => store.updatePlugin('sample', { rateLimitPer10Min: 31 }), /from 1 to 30/)
    assert.throws(() => store.updatePlugin('bad id', { enabled: true }), /Plugin id is invalid/)
    assert.throws(() => store.getPlugin('_host'), /Plugin id is invalid/)
  })
})

test('per-plugin target, host grants, and notification rate are bounded and canonicalized', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    assert.throws(() => store.updatePlugin('sample', { targetPetId: '../outside' }), /target pet id/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['localhost'] }), /granted host/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['127.0.0.1'] }), /granted host/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['*.example.com'] }), /granted host/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: Array.from({ length: 51 }, (_, index) => `api-${index}.example.com`) }), /at most 50/)
    assert.throws(() => store.updatePlugin('sample', { grantedHosts: ['api.example.com', 'api.example.com'] }), /unique/)

    const updated = store.updatePlugin('sample', {
      targetPetId: null,
      grantedHosts: ['api.example.com', 'feeds.example.net'],
      rateLimitPer10Min: 30,
    })
    assert.deepEqual(updated.plugins.sample?.grantedHosts, ['api.example.com', 'feeds.example.net'])
    assert.equal(updated.plugins.sample?.targetPetId, null)
    assert.equal(updated.plugins.sample?.rateLimitPer10Min, 30)
  })
})

test('returned preference objects cannot mutate the cached state', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    const snapshot = store.get()
    snapshot.resources.maxEnabledPlugins = 50
    snapshot.plugins.sample = {
      enabled: true,
      muted: false,
      rateLimitPer10Min: 30,
      targetPetId: null,
      grantedHosts: ['api.example.com'],
    }
    const plugin = store.getPlugin('sample')
    plugin.grantedHosts.push('attacker.example')
    assert.equal(store.get().resources.maxEnabledPlugins, DEFAULT_PLUGIN_RESOURCES.maxEnabledPlugins)
    assert.equal(store.getPlugin('sample').enabled, false)
    assert.deepEqual(store.getPlugin('sample').grantedHosts, [])
  })
})

test('corrupt, oversized, and symlink preference files fail closed to disabled defaults', () => {
  withUserData((userData) => {
    const filePath = path.join(userData, PLUGIN_PREFERENCES_FILENAME)
    fs.writeFileSync(filePath, JSON.stringify({
      pluginsEnabled: true,
      resources: { ...DEFAULT_PLUGIN_RESOURCES, maxEnabledPlugins: 51 },
      plugins: { sample: { enabled: true } },
    }))
    const corrupt = new PluginPreferencesStore(userData)
    assert.equal(corrupt.get().pluginsEnabled, false)
    assert.equal(corrupt.getPlugin('sample').enabled, false)

    fs.writeFileSync(filePath, 'x'.repeat(PLUGIN_PREFERENCES_MAX_BYTES + 1))
    const oversized = new PluginPreferencesStore(userData)
    assert.equal(oversized.get().pluginsEnabled, false)

    fs.rmSync(filePath, { force: true })
    const outside = path.join(userData, 'outside.json')
    fs.writeFileSync(outside, JSON.stringify({ pluginsEnabled: true }))
    fs.symlinkSync(outside, filePath)
    const symlinked = new PluginPreferencesStore(userData)
    assert.equal(symlinked.get().pluginsEnabled, false)
  })
})

test('removePlugin deletes only that plugin settings and writes the remaining preferences', () => {
  withUserData((userData) => {
    const store = new PluginPreferencesStore(userData)
    store.updatePlugin('sample', { enabled: true, grantedHosts: ['api.example.com'] })
    store.updatePlugin('another', { muted: true })
    const remaining = store.removePlugin('sample')
    assert.equal(remaining.plugins.sample, undefined)
    assert.equal(remaining.plugins.another?.muted, true)
    assert.equal(new PluginPreferencesStore(userData).getPlugin('sample').enabled, false)
  })
})
