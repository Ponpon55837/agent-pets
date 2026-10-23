import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { PluginBroker } from '../electron/plugin-broker.ts'
import { PluginFeedController, type PluginFeedPluginState } from '../electron/plugin-feed.ts'
import { PLUGIN_ARCHIVE_MAX_FILES, PluginRegistry } from '../electron/plugin-registry.ts'
import { PLUGIN_CONTENT_SECURITY_POLICY } from '../electron/plugin-protocol.ts'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'
import type { PluginManifest } from '../src/types/plugin.ts'

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugins')
const FIXTURE_IDS = ['ok-notify', 'evil-fetch', 'evil-loop', 'evil-spam', 'evil-xss', 'evil-spoof', 'evil-zip', 'evil-escape', 'evil-network'] as const

function readFixture(pluginId: string): { manifest: PluginManifest; files: Record<string, Uint8Array> } {
  const sourceDirectory = path.join(fixtureRoot, pluginId)
  const manifestBytes = fs.readFileSync(path.join(sourceDirectory, 'plugin.json'))
  const parsed = parsePluginManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown)
  assert.equal(parsed.ok, true, `fixture ${pluginId} has a valid manifest`)
  if (!parsed.ok) throw new Error(parsed.error)

  const files: Record<string, Uint8Array> = {}
  function collect(directory: string, relativeDirectory = ''): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeDirectory, entry.name)
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(absolute, relative)
      else if (entry.isFile()) files[relative] = new Uint8Array(fs.readFileSync(absolute))
    }
  }
  collect(sourceDirectory)
  assert.ok(files['plugin.json'])
  assert.ok(files['dist/main.js'])
  assert.ok(files['assets/icon.png'])
  return { manifest: parsed.manifest, files }
}

function packFixture(pluginId: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const { files } = readFixture(pluginId)
  return zipSync({ ...files, ...extra }, { level: 6 })
}

function createFeed(pluginId: string, manifest: PluginManifest, rateLimitPer10Min = 5) {
  const emitted: Array<{ title: string; body: string }> = []
  const state: PluginFeedPluginState = {
    enabled: true,
    muted: false,
    rateLimitPer10Min,
    name: manifest.name,
  }
  const feed = new PluginFeedController({
    emit: item => emitted.push({ title: item.title, body: item.body }),
    isPetVisible: () => true,
    getGlobalState: () => ({ pluginsEnabled: true, dndEnabled: false, rateLimitPer10Min: 60 }),
    getPluginState: id => id === pluginId ? state : null,
    isLinkHostAllowed: () => false,
    now: () => 1_700_000_000_000,
    createId: (() => {
      let sequence = 0
      return () => `fixture-${String(++sequence).padStart(8, '0')}`
    })(),
  })
  return { feed, emitted }
}

test('plugin fixture sources have bounded manifests, entry points, and PNG icons', () => {
  for (const pluginId of FIXTURE_IDS) {
    const { manifest, files } = readFixture(pluginId)
    assert.equal(manifest.id, pluginId)
    assert.ok(files[manifest.entry])
    assert.deepEqual([...files['assets/icon.png']!.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
})

test('every evil fixture records a host log entry for its runtime probe', () => {
  for (const pluginId of ['evil-fetch', 'evil-loop', 'evil-spam', 'evil-xss', 'evil-spoof', 'evil-zip', 'evil-escape', 'evil-network']) {
    const source = Buffer.from(readFixture(pluginId).files['dist/main.js']!).toString('utf8')
    assert.match(source, /api\.log\.info/, `${pluginId} must leave inspectable evidence`)
  }
})

test('evil-network exercises a successful declared public host and each forbidden URL class', () => {
  const fixture = readFixture('evil-network')
  const source = Buffer.from(fixture.files['dist/main.js']!).toString('utf8')
  assert.ok(fixture.manifest.permissions.network?.hosts.includes('api.github.com'))
  assert.match(source, /api\.net\.fetch\('https:\/\/api\.github\.com\/robots\.txt'\)/)
  for (const marker of [
    'unlisted host', 'http scheme', 'public IP literal', 'localhost', 'private network', 'redirect to loopback',
  ]) assert.ok(source.includes(marker), `missing network rejection probe: ${marker}`)
})

test('all source fixtures can be packed and installed by PluginRegistry', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-fixtures-'))
  try {
    const registry = new PluginRegistry(userData)
    for (const pluginId of FIXTURE_IDS) {
      const planned = registry.planInstall(packFixture(pluginId))
      assert.equal(planned.ok, true, `${pluginId} should produce a valid base install plan`)
      if (!planned.ok) continue
      assert.equal(registry.install(planned.value.token).ok, true, `${pluginId} base fixture should install`)
    }
    assert.equal(registry.list().length, FIXTURE_IDS.length)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('evil-zip path traversal and excess entries are rejected during planning', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-evil-zip-'))
  try {
    const registry = new PluginRegistry(userData)
    assert.deepEqual(registry.planInstall(packFixture('evil-zip', { '../escape.txt': strToU8('outside') })), {
      ok: false,
      error: 'invalid_archive',
    })

    const overflow: Record<string, Uint8Array> = {}
    for (let index = 0; index <= PLUGIN_ARCHIVE_MAX_FILES; index += 1) {
      overflow[`extra/${index}.txt`] = strToU8('x')
    }
    assert.deepEqual(registry.planInstall(packFixture('evil-zip', overflow)), {
      ok: false,
      error: 'invalid_archive',
    })
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('evil-fetch source targets forbidden network APIs and host CSP denies connections', () => {
  const source = Buffer.from(readFixture('evil-fetch').files['dist/main.js']!).toString('utf8')
  for (const api of ['fetch(', 'new WebSocket(', 'importScripts(', "import('https://"]) assert.ok(source.includes(api))
  assert.match(source, /api\.log\.info\(JSON\.stringify\(results\)\)/)
  assert.match(PLUGIN_CONTENT_SECURITY_POLICY, /connect-src 'none'/)
  assert.match(pluginHostAssets['host.js'] ?? '', /worker-crash/)
})

test('evil-loop source contains a blocking loop for manual Worker termination checks', () => {
  const source = Buffer.from(readFixture('evil-loop').files['dist/main.js']!).toString('utf8')
  assert.match(source, /while\s*\(true\)/)
  assert.match(pluginHostAssets['worker-bootstrap.js'] ?? '', /postToHost\(\{ type: 'pong'/)
})

test('evil-spam is rate limited and the excess notifications stay out of bubbles', () => {
  const manifest = readFixture('evil-spam').manifest
  const { feed, emitted } = createFeed('evil-spam', manifest, 5)
  const source = Buffer.from(readFixture('evil-spam').files['dist/main.js']!).toString('utf8')
  assert.match(source, /index < 100/)
  for (let index = 0; index < 100; index += 1) {
    const result = feed.submit('evil-spam', { title: `Spam ${index}`, body: 'Repeated test notification.' })
    assert.equal(result.accepted, index < 5)
    if (result.accepted && result.delivery === 'bubble') feed.complete(result.itemId)
  }
  assert.equal(emitted.length, 5)
  assert.equal(feed.unreadCount(), 95)
})

test('evil-xss notification data is reduced to inert plain text', () => {
  const manifest = readFixture('evil-xss').manifest
  const { feed, emitted } = createFeed('evil-xss', manifest)
  feed.submit('evil-xss', {
    title: '<img src=x onerror=alert(1)>',
    body: '<svg onload=alert(1)>unsafe markup</svg>',
  })
  assert.equal(emitted.length, 1)
  assert.ok(!emitted[0]?.title.includes('<'))
  assert.ok(!emitted[0]?.body.includes('<'))
})

test('evil-spoof cannot claim another plugin id or call an undeclared capability', () => {
  const { manifest } = readFixture('evil-spoof')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-evil-spoof-'))
  const { feed } = createFeed('evil-spoof', manifest)
  try {
    const source = Buffer.from(readFixture('evil-spoof').files['dist/main.js']!).toString('utf8')
    assert.match(source, /DedicatedWorkerGlobalScope\.prototype\.postMessage/)
    assert.match(source, /api\.log\.info\(JSON\.stringify\(results\)\)/)
    const broker = new PluginBroker({
      userDataDirectory: userData,
      getContext: pluginId => pluginId === 'evil-spoof'
        ? { manifest, enabled: true, pluginsEnabled: true, dndEnabled: false, storageBytesPerPlugin: 1024 * 1024 }
        : null,
      feed,
      onReaction: () => ({ ok: true }),
    })
    assert.deepEqual(broker.handle('evil-spoof', {
      id: 'spoof-1',
      pluginId: 'ok-notify',
      method: 'pet.react',
      args: ['jump'],
    }), { id: 'spoof-1', ok: false, error: 'invalid_request' })
    assert.deepEqual(broker.handle('evil-spoof', {
      id: 'spoof-2',
      method: 'pet.react',
      args: ['jump'],
    }), { id: 'spoof-2', ok: false, error: 'not_permitted' })
    assert.deepEqual(broker.handle('ok-notify', {
      id: 'spoof-3',
      method: 'feed.notify',
      args: [{ title: 'spoof', body: 'spoof' }],
    }), { id: 'spoof-3', ok: false, error: 'disabled' })
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('evil-escape logs isolation probes and Host API results are unwrapped', () => {
  const { files } = readFixture('evil-escape')
  const source = Buffer.from(files['dist/main.js']!).toString('utf8')
  for (const probe of [
    'fetch https', 'fetch loopback event server', 'fetch app origin', 'import other plugin module',
    'nested worker', 'BroadcastChannel', 'indexedDB', 'raw rpc via prototype', 'storage round-trip',
  ]) assert.ok(source.includes(probe))
  assert.match(source, /api\.log\.info\(JSON\.stringify\(results\)\)/)
  const bootstrap = pluginHostAssets['worker-bootstrap.js'] ?? ''
  for (const api of ['indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'fetch']) {
    assert.ok(bootstrap.includes(`'${api}'`), `${api} is removed before plugin import`)
  }
  assert.match(bootstrap, /pendingRequest\.resolve\(result\.value\)/)
  assert.match(bootstrap, /pendingRequest\.reject\(error\)/)
  assert.ok(bootstrap.includes("import('agent-pets://plugin/' + pluginToken"))
  assert.match(pluginHostAssets['host.js'] ?? '', /event\.source !== window/)
  assert.match(pluginHostAssets['host.js'] ?? '', /event\.origin !== window\.location\.origin/)
  assert.match(pluginHostAssets['host.js'] ?? '', /portAccepted/)
  const hostPreload = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'plugin-host-preload.ts'), 'utf8')
  assert.match(hostPreload, /window\.postMessage\('agent-pets-plugin-host-port', window\.location\.origin, \[port\]\)/)
  assert.doesNotMatch(hostPreload, /contextBridge/)
})
