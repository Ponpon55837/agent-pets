import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLUGIN_FEED_DEDUPE_WINDOW_MS,
  PLUGIN_FEED_MAX_CENTER_ITEMS,
  PLUGIN_FEED_MAX_DEDUPE_KEYS,
  PLUGIN_FEED_MAX_PER_PLUGIN,
  PLUGIN_FEED_MAX_QUEUE_DEPTH,
  PLUGIN_FEED_RATE_WINDOW_MS,
  PluginFeedController,
  type PluginFeedGlobalState,
  type PluginFeedPluginState,
} from '../electron/plugin-feed.ts'
import type { PluginFeedItem } from '../src/types/plugin.ts'

interface Harness {
  controller: PluginFeedController
  emitted: PluginFeedItem[]
  globalState: PluginFeedGlobalState
  pluginStates: Map<string, PluginFeedPluginState>
  setVisible: (visible: boolean) => void
  setNow: (now: number) => void
  now: () => number
  setPlugin: (pluginId: string, state: Partial<PluginFeedPluginState>) => void
}

function createHarness(options: {
  globalState?: Partial<PluginFeedGlobalState>
  defaultPluginState?: Partial<PluginFeedPluginState>
  visible?: boolean
  allowHost?: (pluginId: string, host: string) => boolean
  resolveIconUrl?: (pluginId: string, path: string) => string | null
} = {}): Harness {
  let currentTime = 1_000_000
  let visible = options.visible ?? true
  let idSequence = 0
  const emitted: PluginFeedItem[] = []
  const globalState: PluginFeedGlobalState = {
    pluginsEnabled: true,
    dndEnabled: false,
    ...options.globalState,
  }
  const pluginStates = new Map<string, PluginFeedPluginState>()
  const getPlugin = (pluginId: string): PluginFeedPluginState => {
    const existing = pluginStates.get(pluginId)
    if (existing) return existing
    const created: PluginFeedPluginState = {
      enabled: true,
      muted: false,
      rateLimitPer10Min: 5,
      name: { 'zh-TW': '測試插件', 'en-US': 'Test Plugin' },
      ...options.defaultPluginState,
    }
    pluginStates.set(pluginId, created)
    return created
  }
  const controller = new PluginFeedController({
    emit: item => emitted.push(item),
    isPetVisible: () => visible,
    getGlobalState: () => globalState,
    getPluginState: pluginId => getPlugin(pluginId),
    isLinkHostAllowed: (pluginId, host) => options.allowHost?.(pluginId, host) ?? host === 'example.com',
    resolveIconUrl: options.resolveIconUrl ?? ((pluginId, iconPath) => `agent-pets://plugin/${pluginId}/${iconPath}`),
    now: () => currentTime,
    createId: () => `feed-${String(++idSequence).padStart(8, '0')}`,
  })

  return {
    controller,
    emitted,
    globalState,
    pluginStates,
    setVisible: value => { visible = value },
    setNow: value => { currentTime = value },
    now: () => currentTime,
    setPlugin: (pluginId, state) => {
      pluginStates.set(pluginId, { ...getPlugin(pluginId), ...state })
    },
  }
}

function submitValid(controller: PluginFeedController, pluginId = 'sample', extra: Record<string, unknown> = {}) {
  return controller.submit(pluginId, { title: 'Update', body: 'A short update', ...extra })
}

function completeIfQueued(controller: PluginFeedController, result: ReturnType<typeof submitValid>): void {
  if (result.accepted && result.delivery === 'bubble') controller.complete(result.itemId)
}

test('PluginFeedController sanitizes text and constructs a bounded host-owned feed item', () => {
  const harness = createHarness()
  const result = harness.controller.submit('sample', {
    title: '  <Fresh>\n',
    body: 'One\tline',
    link: 'https://example.com/news?q=1',
    icon: 'assets/icon.png',
    priority: 'low',
    ttlMs: 15_000,
    dedupeKey: '  item-1  ',
  })

  assert.equal(result.accepted, true)
  assert.equal(harness.emitted.length, 1)
  const item = harness.emitted[0]
  assert.ok(item)
  assert.equal(item.title, 'Fresh')
  assert.equal(item.body, 'One line')
  assert.equal(item.link, 'https://example.com/news?q=1')
  assert.equal(item.iconUrl, 'agent-pets://plugin/sample/assets/icon.png')
  assert.equal(item.priority, 'low')
  assert.equal(item.expiresAt - item.createdAt, 15_000)
  assert.equal(item.pluginId, 'sample')
  assert.deepEqual(item.pluginName, { 'zh-TW': '測試插件', 'en-US': 'Test Plugin' })
  assert.equal(harness.controller.unreadCount(), 0)
})

test('PluginFeedController rejects malformed text, unsupported fields, and out-of-range options', () => {
  const harness = createHarness()
  const invalidInputs: unknown[] = [
    { title: 'x'.repeat(61), body: 'ok' },
    { title: 'ok', body: 'x'.repeat(241) },
    { title: '<>\n', body: 'ok' },
    { title: 'ok', body: 'ok', priority: 'high' },
    { title: 'ok', body: 'ok', ttlMs: 999 },
    { title: 'ok', body: 'ok', ttlMs: 15_001 },
    { title: 'ok', body: 'ok', ttlMs: 1.5 },
    { title: 'ok', body: 'ok', dedupeKey: 'k'.repeat(129) },
    { title: 'ok', body: 'ok', unknown: true },
    { title: 'ok', body: 'ok', icon: '../outside.png' },
    { title: 'ok', body: 'ok', icon: 'assets/%2e%2e/icon.png' },
    { title: 'ok', body: 'ok', icon: 'assets/CON.png' },
  ]
  for (const input of invalidInputs) {
    assert.deepEqual(harness.controller.submit('sample', input), { accepted: false, error: 'invalid_request' })
  }
  assert.equal(harness.emitted.length, 0)
  assert.equal(harness.controller.listNotifications().length, 0)
})

test('links require https, a public DNS host on the plugin allowlist, and no alternate port or credentials', () => {
  const harness = createHarness()
  const invalidLinks = [
    'http://example.com/news',
    'https://evil.example/news',
    'https://127.0.0.1/news',
    'https://localhost/news',
    'https://service.internal/news',
    'https://example.com:8443/news',
    'https://user@example.com/news',
  ]
  for (const link of invalidLinks) {
    const result = submitValid(harness.controller, 'sample', { link })
    assert.deepEqual(result, { accepted: false, error: 'host_not_allowed' }, link)
  }
  assert.equal(harness.controller.submit('sample', { title: 'Update', body: 'ok', link: 'https://[invalid' }).accepted, false)
  assert.equal(harness.emitted.length, 0)
})

test('links fail closed when the caller allowlist check throws', () => {
  const harness = createHarness({ allowHost: () => { throw new Error('unavailable') } })
  assert.deepEqual(submitValid(harness.controller, 'sample', { link: 'https://example.com' }), {
    accepted: false,
    error: 'host_not_allowed',
  })
})

test('plugin and global sliding rates default to 5 and 60 per ten minutes', () => {
  const pluginHarness = createHarness({ defaultPluginState: { rateLimitPer10Min: undefined } })
  for (let index = 0; index < 5; index += 1) {
    const result = submitValid(pluginHarness.controller)
    assert.equal(result.accepted, true)
    completeIfQueued(pluginHarness.controller, result)
  }
  const pluginLimited = submitValid(pluginHarness.controller)
  assert.equal(pluginLimited.accepted, false)
  if (!pluginLimited.accepted) {
    assert.equal(pluginLimited.error, 'rate_limited')
    assert.equal(pluginLimited.retryAfterMs, PLUGIN_FEED_RATE_WINDOW_MS)
  }
  pluginHarness.setNow(pluginHarness.now() + PLUGIN_FEED_RATE_WINDOW_MS)
  const afterWindow = submitValid(pluginHarness.controller)
  assert.equal(afterWindow.accepted, true)

  const globalHarness = createHarness({ defaultPluginState: { rateLimitPer10Min: 30 } })
  for (let index = 0; index < 60; index += 1) {
    const pluginId = `plug-${String(Math.floor(index / 30)).padStart(2, '0')}`
    const result = submitValid(globalHarness.controller, pluginId)
    assert.equal(result.accepted, true)
    completeIfQueued(globalHarness.controller, result)
  }
  const globalLimited = submitValid(globalHarness.controller, 'plug-02')
  assert.equal(globalLimited.accepted, false)
  if (!globalLimited.accepted) assert.equal(globalLimited.error, 'rate_limited')
})

test('muted, DND, disabled global switch, and disabled plugin do not count against rate limits', () => {
  const harness = createHarness()
  harness.setPlugin('sample', { muted: true })
  const muted = submitValid(harness.controller)
  assert.equal(muted.accepted, true)
  if (muted.accepted) assert.equal(muted.delivery, 'center')
  assert.equal(harness.emitted.length, 0)
  assert.equal(harness.controller.unreadCount(), 1)

  harness.setPlugin('sample', { muted: false, enabled: false })
  assert.deepEqual(submitValid(harness.controller), { accepted: false, error: 'disabled' })
  harness.setPlugin('sample', { enabled: true })
  harness.globalState.dndEnabled = true
  assert.deepEqual(submitValid(harness.controller), { accepted: false, error: 'disabled' })
  harness.globalState.dndEnabled = false
  harness.globalState.pluginsEnabled = false
  assert.deepEqual(submitValid(harness.controller), { accepted: false, error: 'disabled' })
  harness.globalState.pluginsEnabled = true

  for (let index = 0; index < 5; index += 1) {
    const result = submitValid(harness.controller)
    assert.equal(result.accepted, true)
    completeIfQueued(harness.controller, result)
  }
})

test('dedupe is scoped to a plugin and expires after 24 hours', () => {
  const harness = createHarness()
  const first = submitValid(harness.controller, 'sample', { dedupeKey: 'same' })
  assert.equal(first.accepted, true)
  completeIfQueued(harness.controller, first)
  assert.deepEqual(submitValid(harness.controller, 'sample', { dedupeKey: 'same' }), {
    accepted: false,
    error: 'duplicate',
  })
  const otherPlugin = submitValid(harness.controller, 'other', { dedupeKey: 'same' })
  assert.equal(otherPlugin.accepted, true)
  completeIfQueued(harness.controller, otherPlugin)

  harness.setNow(harness.now() + PLUGIN_FEED_DEDUPE_WINDOW_MS)
  const afterExpiry = submitValid(harness.controller, 'sample', { dedupeKey: 'same' })
  assert.equal(afterExpiry.accepted, true)
})

test('dedupe memory remains bounded to 500 keys and evicts the oldest key', () => {
  const harness = createHarness({ defaultPluginState: { rateLimitPer10Min: 30 } })
  for (let index = 0; index <= PLUGIN_FEED_MAX_DEDUPE_KEYS; index += 1) {
    if (index > 0 && index % 30 === 0) harness.setNow(harness.now() + PLUGIN_FEED_RATE_WINDOW_MS + 1)
    const result = submitValid(harness.controller, 'sample', { dedupeKey: `key-${index}` })
    assert.equal(result.accepted, true)
    completeIfQueued(harness.controller, result)
  }
  const evictedOldest = submitValid(harness.controller, 'sample', { dedupeKey: 'key-0' })
  assert.equal(evictedOldest.accepted, true)
})

test('visible feeds queue up to eight, preserve FIFO, and keep overflow in the center', () => {
  const harness = createHarness({ defaultPluginState: { rateLimitPer10Min: 30 } })
  const queued: string[] = []
  for (let index = 0; index < PLUGIN_FEED_MAX_QUEUE_DEPTH; index += 1) {
    const result = submitValid(harness.controller, 'sample', { title: `Message ${index}` })
    assert.equal(result.accepted, true)
    if (result.accepted) queued.push(result.itemId)
  }
  assert.equal(harness.controller.getQueueDepth(), PLUGIN_FEED_MAX_QUEUE_DEPTH)
  const overflow = submitValid(harness.controller, 'sample', { title: 'Overflow' })
  assert.equal(overflow.accepted, false)
  if (!overflow.accepted) assert.equal(overflow.error, 'queue_full')
  assert.equal(harness.controller.listNotifications('sample').length, PLUGIN_FEED_MAX_QUEUE_DEPTH + 1)

  for (const itemId of queued) {
    assert.equal(harness.emitted.at(-1)?.id, itemId)
    assert.equal(harness.controller.complete(itemId), true)
  }
  assert.equal(harness.controller.getQueueDepth(), 0)
})

test('expired active item no longer blocks a later live queue entry', () => {
  const harness = createHarness({ defaultPluginState: { rateLimitPer10Min: 30 } })
  const first = submitValid(harness.controller, 'sample', { ttlMs: 1_000 })
  const second = submitValid(harness.controller, 'sample', { ttlMs: 15_000 })
  assert.equal(first.accepted, true)
  assert.equal(second.accepted, true)
  if (!first.accepted || !second.accepted) return
  harness.setNow(harness.now() + 1_001)
  assert.equal(harness.controller.getQueueDepth(), 1)
  assert.equal(harness.emitted.at(-1)?.id, second.itemId)
})

test('hidden visibility stores notifications and restores only the latest on becoming visible', () => {
  const harness = createHarness({ visible: false, defaultPluginState: { rateLimitPer10Min: 30 } })
  const hiddenItems: string[] = []
  for (let index = 0; index < 3; index += 1) {
    const result = submitValid(harness.controller, 'sample', { title: `Hidden ${index}` })
    assert.equal(result.accepted, true)
    if (result.accepted) hiddenItems.push(result.itemId)
  }
  assert.equal(harness.emitted.length, 0)
  assert.equal(harness.controller.unreadCount(), 3)

  harness.setVisible(true)
  harness.controller.onVisibilityChanged()
  assert.equal(harness.emitted.length, 1)
  assert.equal(harness.emitted[0]?.id, hiddenItems.at(-1))
  assert.equal(harness.controller.unreadCount(), 2)
})

test('an active bubble becomes unread in the center and is restored after visibility returns', () => {
  const harness = createHarness()
  const result = submitValid(harness.controller)
  assert.equal(result.accepted, true)
  if (!result.accepted) return
  assert.equal(harness.controller.unreadCount(), 0)

  harness.setVisible(false)
  harness.controller.onVisibilityChanged()
  assert.equal(harness.controller.unreadCount(), 1)
  assert.equal(harness.emitted.length, 1)

  harness.setVisible(true)
  harness.controller.onVisibilityChanged()
  assert.equal(harness.emitted.length, 2)
  assert.equal(harness.emitted[1]?.id, result.itemId)
  assert.equal(harness.controller.unreadCount(), 0)
})

test('notification center supports list, read, clear, and bounded per-plugin/global retention', () => {
  const harness = createHarness({ visible: false, defaultPluginState: { rateLimitPer10Min: 30 } })
  for (let index = 0; index < PLUGIN_FEED_MAX_PER_PLUGIN + 1; index += 1) {
    harness.setNow(harness.now() + PLUGIN_FEED_RATE_WINDOW_MS + 1)
    const result = submitValid(harness.controller, 'sample', { title: `Sample ${index}` })
    assert.equal(result.accepted, true)
    completeIfQueued(harness.controller, result)
  }
  assert.equal(harness.controller.listNotifications('sample').length, PLUGIN_FEED_MAX_PER_PLUGIN)
  const newest = harness.controller.listNotifications('sample')[0]
  assert.ok(newest)
  assert.equal(newest.item.title, `Sample ${PLUGIN_FEED_MAX_PER_PLUGIN}`)
  assert.equal(harness.controller.markRead(newest.item.id), true)
  assert.equal(harness.controller.markRead(newest.item.id), false)
  assert.equal(harness.controller.clear('sample'), PLUGIN_FEED_MAX_PER_PLUGIN)
  assert.equal(harness.controller.unreadCount(), 0)

  for (let plugin = 0; plugin < 6; plugin += 1) {
    const pluginId = `group-${plugin}`
    for (let index = 0; index < 100; index += 1) {
      harness.setNow(harness.now() + PLUGIN_FEED_RATE_WINDOW_MS + 1)
      const result = submitValid(harness.controller, pluginId, { title: `${pluginId} ${index}` })
      assert.equal(result.accepted, true)
      completeIfQueued(harness.controller, result)
    }
  }
  assert.equal(harness.controller.listNotifications().length, PLUGIN_FEED_MAX_CENTER_ITEMS)
  for (let plugin = 0; plugin < 6; plugin += 1) {
    assert.ok(harness.controller.listNotifications(`group-${plugin}`).length <= PLUGIN_FEED_MAX_PER_PLUGIN)
  }
  assert.equal(harness.controller.clear(), PLUGIN_FEED_MAX_CENTER_ITEMS)
})

test('invalid plugin identity, preference state, clock, and asset resolution fail closed', () => {
  const harness = createHarness()
  assert.deepEqual(submitValid(harness.controller, '_host'), { accepted: false, error: 'invalid_request' })

  const invalidRateState = createHarness({ defaultPluginState: { rateLimitPer10Min: 31 } })
  assert.deepEqual(submitValid(invalidRateState.controller), { accepted: false, error: 'disabled' })

  const invalidIconResolver = createHarness({ resolveIconUrl: () => 'https://attacker.example/icon.png' })
  assert.deepEqual(submitValid(invalidIconResolver.controller, 'sample', { icon: 'icon.png' }), {
    accepted: false,
    error: 'invalid_request',
  })
})
