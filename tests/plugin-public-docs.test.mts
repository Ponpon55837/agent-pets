import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import test from 'node:test'
import { parsePluginManifest } from '../electron/plugin-manifest.ts'

const docsDirectory = path.resolve('docs/plugins')

test('every public plugin example manifest passes the runtime validator', () => {
  const examplesDirectory = path.join(docsDirectory, 'examples')
  for (const example of fs.readdirSync(examplesDirectory, { withFileTypes: true })) {
    if (!example.isDirectory()) continue
    const manifestPath = path.join(examplesDirectory, example.name, 'plugin.json')
    assert.equal(fs.existsSync(manifestPath), true, `${example.name} must contain plugin.json`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
    const parsed = parsePluginManifest(manifest)
    assert.equal(parsed.ok, true, `${example.name}: ${parsed.ok ? '' : parsed.error}`)
  }
})

test('public manifest schema required keys and enums match the runtime validator', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(docsDirectory, 'plugin.schema.json'), 'utf8')) as {
    required: string[]
    properties: Record<string, { const?: string; enum?: string[]; description?: string; properties?: Record<string, { description?: string; properties?: Record<string, { type?: string; enum?: string[]; const?: string }> }> }>
    $defs: Record<string, { properties?: Record<string, { enum?: string[]; const?: string }> }>
  }
  assert.deepEqual(schema.required, ['id', 'name', 'version', 'apiVersion', 'author', 'permissions', 'contributes'])
  assert.equal(schema.properties.apiVersion?.const, '1')
  assert.deepEqual(Object.keys(schema.properties.permissions?.properties ?? {}).sort(), ['agentStatus', 'network', 'schedule', 'secrets', 'storage'])
  assert.deepEqual(Object.keys(schema.properties.contributes?.properties ?? {}).sort(), ['badge', 'commands', 'feed', 'panelView', 'reaction', 'settings', 'skins', 'tray'])
  const panelView = schema.properties.contributes?.properties?.panelView
  assert.match(panelView?.description ?? '', /sandboxed host view/)
  assert.equal(panelView?.properties?.preferredSize?.properties?.width?.type, 'integer')
  assert.equal(panelView?.properties?.preferredSize?.properties?.height?.type, 'integer')
  assert.match(panelView?.properties?.preferredSize?.description ?? '', /320–960 px.*240–800 px/)
  assert.deepEqual(schema.$defs.setting?.properties?.type?.enum, ['string', 'number', 'boolean'])
  assert.equal(schema.$defs.setting?.properties?.format?.const, 'secret')

  const base = JSON.parse(fs.readFileSync(path.join(docsDirectory, 'examples/hello-feed/plugin.json'), 'utf8')) as Record<string, unknown>
  assert.equal(parsePluginManifest(base).ok, true)
  assert.equal(parsePluginManifest({ ...base, apiVersion: '2' }).ok, false)
  assert.equal(parsePluginManifest({ ...base, extra: true }).ok, false)
})

test('getting-started tutorial writes its package outside the watched source folder', () => {
  for (const suffix of ['.zh-TW', '']) {
    const content = fs.readFileSync(path.join(docsDirectory, `getting-started${suffix}.md`), 'utf8')
    assert.match(content, /zip -r \.\.\/hello-feed\.agentpet-plugin plugin\.json dist\//)
  }
})

test('plugin network and secret docs match redirect, cookie, and settings event behavior', () => {
  const api = fs.readFileSync(path.join(docsDirectory, 'api-reference.md'), 'utf8')
  const apiZh = fs.readFileSync(path.join(docsDirectory, 'api-reference.zh-TW.md'), 'utf8')
  const limits = fs.readFileSync(path.join(docsDirectory, 'limits.md'), 'utf8')
  const limitsZh = fs.readFileSync(path.join(docsDirectory, 'limits.zh-TW.md'), 'utf8')
  const security = fs.readFileSync(path.join(docsDirectory, 'security.md'), 'utf8')
  const securityZh = fs.readFileSync(path.join(docsDirectory, 'security.zh-TW.md'), 'utf8')

  assert.match(api, /up to three redirects/)
  assert.match(apiZh, /最多 3 次 redirect/)
  assert.match(limits, /at most three redirects/)
  assert.match(limitsZh, /最多跟隨 3 個 redirect/)
  assert.match(api, /do not send or store cookies/)
  assert.match(apiZh, /不會送出或儲存 Cookie/)
  assert.match(api, /secret additions, updates, or clears trigger the callback/)
  assert.match(apiZh, /密鑰新增、更新或清除都會觸發 callback/)
  assert.match(security, /DNS rebinding race/)
  assert.match(securityZh, /DNS rebinding 時間差風險/)
})

test('panel-view guide, API declarations, and panel-demo document the restricted P15 contract', () => {
  const panel = fs.readFileSync(path.join(docsDirectory, 'panel-view.md'), 'utf8')
  const panelZh = fs.readFileSync(path.join(docsDirectory, 'panel-view.zh-TW.md'), 'utf8')
  const api = fs.readFileSync(path.join(docsDirectory, 'agent-pets-plugin.d.ts'), 'utf8')
  const example = path.join(docsDirectory, 'examples/panel-demo')
  const exampleManifest = JSON.parse(fs.readFileSync(path.join(example, 'plugin.json'), 'utf8')) as Record<string, unknown>

  assert.match(panel, /secrets\.get|`secrets\.get`/)
  assert.match(panel, /net\.requestHost/)
  assert.match(panel, /256 KB/)
  assert.match(panel, /20 messages per second/)
  assert.match(panel, /agent-pets:\/\/plugin\/_shared\/tokens\.css/)
  assert.match(panelZh, /256 KB/)
  assert.match(panelZh, /每秒最多 20 則/)
  assert.match(panelZh, /agent-pets:\/\/plugin\/_shared\/tokens\.css/)
  assert.match(api, /interface PluginPanelViewContribution[\s\S]*?preferredSize\?: \{[\s\S]*?width: number[\s\S]*?height: number/)
  assert.match(api, /interface AgentPetsPluginPanelApi/)
  assert.match(api, /ui: \{[\s\S]*?postMessage\(data: PluginJsonValue\): Promise<\{ delivered: boolean \}>/)
  const panelApi = api.split('export interface AgentPetsPluginPanelApi {')[1]?.split('\ndeclare global')[0]
  assert.ok(panelApi, 'panel API declaration must be present')
  assert.doesNotMatch(panelApi, /secrets|requestHost/)
  assert.equal(parsePluginManifest(exampleManifest).ok, true)
  for (const relative of ['dist/main.js', 'ui/index.html', 'ui/panel.js', 'ui/panel.css', 'assets/icon.png']) {
    assert.equal(fs.existsSync(path.join(example, relative)), true, `panel-demo missing ${relative}`)
  }
})
