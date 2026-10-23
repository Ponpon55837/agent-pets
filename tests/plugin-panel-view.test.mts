import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PluginPanelViewController,
  PLUGIN_PANEL_MESSAGE_MAX_BYTES,
  PLUGIN_PANEL_PARTITION_PREFIX,
  isPluginPanelResourceAllowed,
  type PluginPanelNativeView,
  type PluginPanelViewCancelableEvent,
  type PluginPanelViewSession,
} from '../electron/plugin-panel-view.ts'
import { createPluginPanelPublicApi } from '../electron/plugin-panel-view-bridge.ts'
import { PluginUiMessageGuard } from '../electron/plugin-ui-messages.ts'

const token = '123e4567-e89b-42d3-a456-426614174000'

function fakeController() {
  let sessionPartition = ''
  let viewOptions: { webPreferences: Record<string, unknown> } | null = null
  let loadedUrl = ''
  let destroyed = false
  let permissionRequest: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null = null
  let permissionCheck: ((...args: unknown[]) => boolean) | null = null
  let beforeRequest: ((details: { url: string; method?: string }, callback: (decision: { cancel: boolean }) => void) => void) | null = null
  let willDownload: ((event: PluginPanelViewCancelableEvent) => void) | null = null
  let openHandler: (() => { action: 'deny' }) | null = null
  let addedView: PluginPanelNativeView | null = null
  let removeCount = 0
  const prevented = new Set<string>()
  const listeners = new Map<string, (event?: PluginPanelViewCancelableEvent) => void>()
  const revoked: Array<{ pluginId: string; token: string }> = []
  const apiRequests: Array<{ pluginId: string; method: string }> = []
  const sentMessages: unknown[] = []

  const session = {
    protocol: { handle: () => {} },
    webRequest: { onBeforeRequest: (_filter: { urls: string[] }, listener: typeof beforeRequest) => { beforeRequest = listener } },
    setPermissionRequestHandler: (handler: typeof permissionRequest) => { permissionRequest = handler },
    setPermissionCheckHandler: (handler: typeof permissionCheck) => { permissionCheck = handler },
    on: (_event: 'will-download', listener: typeof willDownload) => { willDownload = listener },
  } as unknown as PluginPanelViewSession

  const parent = {
    isDestroyed: () => false,
    addChildView: (view: PluginPanelNativeView) => { addedView = view },
    removeChildView: (_view: PluginPanelNativeView) => { removeCount += 1 },
  }

  const controller = new PluginPanelViewController({
    preloadPath: '/app/plugin-ui-preload.js',
    tokensCss: ':root {}',
    getParentWindow: () => parent,
    createSession: partition => { sessionPartition = partition; return session },
    createView: options => {
      viewOptions = options as unknown as { webPreferences: Record<string, unknown> }
      const contents = {
        setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler },
        on: (event: string, listener: (event?: PluginPanelViewCancelableEvent) => void) => { listeners.set(event, listener) },
        loadURL: async (url: string) => { loadedUrl = url },
        send: (_channel: string, data: unknown) => { sentMessages.push(data) },
        destroy: () => { destroyed = true },
        isDestroyed: () => destroyed,
      }
      return {
        webContents: contents,
        setBounds: () => {},
        setVisible: () => {},
      } as unknown as PluginPanelNativeView
    },
    createToken: () => token,
    revokeToken: (pluginId, value) => revoked.push({ pluginId, token: value }),
    pluginRootForToken: value => value === token ? '/plugin/sample/1.0.0' : null,
    messageGuard: new PluginUiMessageGuard(() => 10),
    onApiRequest: (pluginId, request) => {
      apiRequests.push({ pluginId, method: request.method })
      return { ok: true, value: { method: request.method } }
    },
  })

  return {
    controller,
    parent,
    get sessionPartition() { return sessionPartition },
    get viewOptions() { return viewOptions },
    get loadedUrl() { return loadedUrl },
    get addedView() { return addedView },
    get destroyed() { return destroyed },
    get permissionRequest() { return permissionRequest },
    get permissionCheck() { return permissionCheck },
    get beforeRequest() { return beforeRequest },
    get willDownload() { return willDownload },
    get openHandler() { return openHandler },
    get removeCount() { return removeCount },
    get prevented() { return prevented },
    get listeners() { return listeners },
    get revoked() { return revoked },
    get apiRequests() { return apiRequests },
    get sentMessages() { return sentMessages },
  }
}

test('plugin panel uses an ephemeral plugin-specific WebContentsView and a token-scoped protocol', async () => {
  const fake = fakeController()
  const result = await fake.controller.open({ pluginId: 'sample-plugin', entry: 'ui/index.html' })
  assert.deepEqual(result, { ok: true, value: { opened: true } })
  assert.equal(fake.sessionPartition, `${PLUGIN_PANEL_PARTITION_PREFIX}sample-plugin`)
  assert.deepEqual(fake.viewOptions?.webPreferences, {
    preload: '/app/plugin-ui-preload.js',
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    partition: 'plugin-ui-sample-plugin',
    devTools: false,
  })
  assert.equal(fake.loadedUrl, `agent-pets://plugin/${token}/ui/index.html`)
  assert.equal(fake.controller.activePluginId(), 'sample-plugin')

  const decisions: Array<{ url: string; method: string; cancel: boolean }> = []
  fake.beforeRequest?.({ url: fake.loadedUrl, method: 'GET' }, decision => decisions.push({ url: fake.loadedUrl, method: 'GET', cancel: decision.cancel }))
  fake.beforeRequest?.({ url: 'https://example.com/', method: 'GET' }, decision => decisions.push({ url: 'https://example.com/', method: 'GET', cancel: decision.cancel }))
  fake.beforeRequest?.({ url: `agent-pets://plugin/${token}/ui/app.js`, method: 'POST' }, decision => decisions.push({ url: 'post', method: 'POST', cancel: decision.cancel }))
  assert.deepEqual(decisions.map(item => item.cancel), [false, true, true])

  const deniedPermissions: boolean[] = []
  fake.permissionRequest?.({}, 'media', allowed => deniedPermissions.push(allowed))
  assert.deepEqual(deniedPermissions, [false])
  assert.equal(fake.permissionCheck?.({}, 'media'), false)
  let downloadPrevented = false
  fake.willDownload?.({ preventDefault: () => { downloadPrevented = true } })
  assert.equal(downloadPrevented, true)
  assert.deepEqual(fake.openHandler?.(), { action: 'deny' })

  for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let blocked = false
    fake.listeners.get(eventName)?.({ preventDefault: () => { blocked = true } })
    assert.equal(blocked, true, eventName)
  }

  const contents = fake.addedView?.webContents
  const success = await fake.controller.handleApiRequest(contents, 'feed.notify', [{ title: 'ok' }])
  assert.deepEqual(success, { ok: true, value: { method: 'feed.notify' } })
  assert.deepEqual(fake.controller.postMessage('sample-plugin', { type: 'from-worker' }), { ok: true, value: { delivered: true } })
  assert.deepEqual(fake.controller.postMessage('another-plugin', { type: 'private' }), { ok: true, value: { delivered: false } })
  assert.deepEqual(fake.sentMessages, [{ type: 'from-worker' }])
  const forbidden = await fake.controller.handleApiRequest(contents, 'secrets.get', ['secret'])
  assert.deepEqual(forbidden, { ok: false, error: 'not_permitted' })
  assert.deepEqual(
    await fake.controller.handleApiRequest(contents, 'ui.postMessage', ['x'.repeat(PLUGIN_PANEL_MESSAGE_MAX_BYTES + 1)]),
    { ok: false, error: 'too_large' },
  )
  assert.deepEqual(fake.apiRequests, [{ pluginId: 'sample-plugin', method: 'feed.notify' }])
  assert.deepEqual(await fake.controller.handleApiRequest({}, 'storage.get', ['key']), { ok: false, error: 'not_permitted' })

  fake.controller.close()
  assert.deepEqual(fake.controller.postMessage('sample-plugin', { type: 'after-close' }), { ok: true, value: { delivered: false } })
  assert.equal(fake.destroyed, true)
  assert.equal(fake.removeCount, 1)
  assert.deepEqual(fake.revoked, [{ pluginId: 'sample-plugin', token }])
  assert.equal(fake.controller.activePluginId(), null)
})

test('plugin panel request policy rejects external, cross-token, non-GET, and traversal requests', () => {
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/ui/index.html`, token), true)
  assert.equal(isPluginPanelResourceAllowed('agent-pets://plugin/_shared/tokens.css', token), true)
  assert.equal(isPluginPanelResourceAllowed('https://example.com/', token), false)
  assert.equal(isPluginPanelResourceAllowed('agent-pets://plugin/other-token/ui/index.html', token), false)
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/ui/index.html`, token, 'POST'), false)
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/%2e%2e/secret.html`, token), false)
  assert.equal(isPluginPanelResourceAllowed(`agent-pets://plugin/${token}/ui/index.html?redirect=1`, token), false)
})

test('plugin panel preload bridge exposes only the approved API subset and unwraps coded errors', async () => {
  const messages = new Set<(data: unknown) => void>()
  const api = createPluginPanelPublicApi({
    invoke: async (method, args) => {
      if (method === 'feed.notify') return { ok: true, value: { itemId: 'item-1' } }
      if (method === 'ui.postMessage' && args[0] && typeof args[0] === 'object'
        && 'type' in args[0] && args[0].type === 'limited') return { ok: false, error: 'rate_limited' }
      if (method === 'ui.postMessage') return { ok: true, value: { delivered: true } }
      return { ok: false, error: 'not_permitted' }
    },
    onMessage: listener => { messages.add(listener); return () => messages.delete(listener) },
  })
  assert.deepEqual(Object.keys(api).sort(), ['feed', 'log', 'net', 'pet', 'settings', 'storage', 'ui'])
  assert.equal('secrets' in api, false)
  assert.equal('requestHost' in api.net, false)
  assert.deepEqual(await api.feed.notify({ title: 'test' }), { itemId: 'item-1' })
  assert.deepEqual(await api.ui.postMessage({ type: 'panel' }), { delivered: true })
  await assert.rejects(api.ui.postMessage({ type: 'limited' }), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'rate_limited'
  ))
  await assert.rejects(api.storage.get('key'), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'not_permitted'
  ))

  const received: unknown[] = []
  const dispose = api.ui.onMessage(value => received.push(value))
  for (const listener of messages) listener({ type: 'worker' })
  assert.deepEqual(received, [{ type: 'worker' }])
  dispose()
  assert.equal(messages.size, 0)
})
