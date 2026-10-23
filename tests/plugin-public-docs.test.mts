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
    properties: Record<string, { const?: string; enum?: string[]; properties?: Record<string, { properties?: Record<string, { enum?: string[]; const?: string }> }> }>
    $defs: Record<string, { properties?: Record<string, { enum?: string[]; const?: string }> }>
  }
  assert.deepEqual(schema.required, ['id', 'name', 'version', 'apiVersion', 'author', 'entry', 'permissions', 'contributes'])
  assert.equal(schema.properties.apiVersion?.const, '1')
  assert.deepEqual(Object.keys(schema.properties.permissions?.properties ?? {}).sort(), ['agentStatus', 'network', 'schedule', 'secrets', 'storage'])
  assert.deepEqual(Object.keys(schema.properties.contributes?.properties ?? {}).sort(), ['feed', 'panelView', 'reaction', 'settings'])
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
