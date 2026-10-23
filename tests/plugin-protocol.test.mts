import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import {
  handlePluginProtocolRequest,
  createPluginHostProtocolHandler,
  PLUGIN_CONTENT_SECURITY_POLICY,
  PLUGIN_WORKER_CONTENT_SECURITY_POLICY,
} from '../electron/plugin-protocol.ts'
import { pluginHostAssets } from '../electron/plugin-host-assets.ts'

function withPluginRoot(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-plugin-protocol-'))
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('plugin protocol serves only current plugin files with the required CSP and MIME headers', async () => {
  await withPluginRoot(async (userData) => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist', 'main.js'), 'export default 1')
    const response = handlePluginProtocolRequest('agent-pets://plugin/sample-plugin/dist/main.js', {
      pluginRootForId: id => id === 'sample-plugin' ? root : null,
      hostAssets: pluginHostAssets,
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('content-security-policy'), PLUGIN_CONTENT_SECURITY_POLICY)
    assert.equal(await response.text(), 'export default 1')
  })
})

test('plugin protocol serves embedded host resources and denies uninstalled or disabled ids', async () => {
  const response = handlePluginProtocolRequest('agent-pets://plugin/_host/worker-bootstrap.js', {
    pluginRootForId: () => null,
    hostAssets: pluginHostAssets,
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.match(await response.text(), /removeCrossPluginApis/)

  for (const url of [
    'agent-pets://plugin/unknown-plugin/main.js',
    'agent-pets://plugin/sample-plugin/%2e%2e/secret.js',
    'agent-pets://plugin/_host/unknown.js',
    'agent-pets://plugin/sample-plugin/main.js?query=1',
  ]) {
    assert.equal(handlePluginProtocolRequest(url, { pluginRootForId: () => null, hostAssets: pluginHostAssets }).status, 404)
  }
})

test('plugin protocol refuses symlink files and non-regular file paths', () => {
  if (process.platform === 'win32') return
  withPluginRoot((userData) => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(root, { recursive: true })
    const outside = path.join(userData, 'outside.js')
    fs.writeFileSync(outside, 'secret')
    fs.symlinkSync(outside, path.join(root, 'main.js'))
    const options = { pluginRootForId: () => root, hostAssets: pluginHostAssets }
    assert.equal(handlePluginProtocolRequest('agent-pets://plugin/sample-plugin/main.js', options).status, 404)
    assert.equal(handlePluginProtocolRequest('agent-pets://plugin/sample-plugin/missing.js', options).status, 404)
  })
})

test('plugin-host partition handler serves only token-scoped plugin files and embedded host assets', () => {
  withPluginRoot(userData => {
    const root = path.join(userData, 'sample-plugin', '1.0.0')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist', 'main.js'), 'export default 1')
    const token = '123e4567-e89b-42d3-a456-426614174000'
    let currentRoot: string | null = root
    const handler = createPluginHostProtocolHandler({
      pluginRootForToken: value => value === token ? currentRoot : null,
      hostAssets: pluginHostAssets,
    })
    const pluginResponse = handler({ url: `agent-pets://plugin/${token}/dist/main.js`, method: 'GET' })
    assert.equal(pluginResponse.status, 200)
    assert.equal(pluginResponse.headers.get('content-security-policy'), PLUGIN_WORKER_CONTENT_SECURITY_POLICY)
    assert.equal(pluginResponse.status, 200)
    assert.equal(handler({ url: `agent-pets://plugin/${token}/dist/main.js` }).status, 200)
    assert.equal(handler({ url: 'agent-pets://plugin/sample-plugin/dist/main.js', method: 'GET' }).status, 404)
    assert.equal(handler({ url: `agent-pets://plugin/${token}/dist/main.js`, method: 'POST' }).status, 405)
    assert.equal(handler({ url: 'agent-pets://app/index.html', method: 'GET' }).status, 404)
    assert.equal(handler({ url: 'agent-pets://custom/pet/spritesheet.webp', method: 'GET' }).status, 404)
    assert.equal(handler({ url: 'agent-pets://plugin/unknown-token/dist/main.js', method: 'GET' }).status, 404)
    assert.equal(handler({ url: `agent-pets://plugin/${token}/dist/main.js?x=1`, method: 'GET' }).status, 404)
    currentRoot = null
    assert.equal(handler({ url: `agent-pets://plugin/${token}/dist/main.js`, method: 'GET' }).status, 404)

    const workerBootstrap = handler({ url: 'agent-pets://plugin/_host/worker-bootstrap.js', method: 'GET' })
    assert.equal(workerBootstrap.status, 200)
    assert.equal(workerBootstrap.headers.get('content-security-policy'), PLUGIN_WORKER_CONTENT_SECURITY_POLICY)
    assert.match(PLUGIN_CONTENT_SECURITY_POLICY, /worker-src agent-pets:\/\/plugin/)
    assert.match(PLUGIN_WORKER_CONTENT_SECURITY_POLICY, /worker-src 'none'/)
  })
})
