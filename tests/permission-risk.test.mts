import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyClaudeToolRisk, classifyPermissionRisk, isClaudeNetworkTool, isNetworkPermission, toolBaseName } from '../electron/permission-risk.ts'
import { PermissionBroker } from '../electron/permission-broker.ts'

test('only exact read-only tools are low risk', () => {
  for (const name of ['read', 'glob', 'grep', 'list', 'READ', ' Read ']) {
    assert.equal(classifyPermissionRisk(name), 'low', name)
  }
})

test('unknown, renamed and compound tool names fail closed to high', () => {
  for (const name of ['bash', 'edit', 'write', 'multiedit', 'patch', 'apply_patch', 'notebook', 'task', 'unheard_of', 'read_secrets', 'reader', 'webfetch', '']) {
    assert.equal(classifyPermissionRisk(name), 'high', name)
  }
})

test('MCP-wrapped, separated and argument-bearing names are high risk', () => {
  for (const name of ['mcp__server__bash', 'mcp__files__read', 'mcp__x__read', 'mcp__read__bash', 'foo:list', 'a b list',
    'x/read', 'x\\read', 'ns.read', 'rm -rf x list', 'read file', 'read\tgrep', 'read\nbash', 'read;rm']) {
    assert.equal(classifyPermissionRisk(name), 'high', name)
  }
  assert.equal(toolBaseName('mcp__srv__Do.Thing'), 'thing')
})

test('network tools are flagged', () => {
  assert.equal(isNetworkPermission('webfetch'), true)
  assert.equal(isNetworkPermission('external_directory'), true)
  assert.equal(isNetworkPermission('read'), false)
})

test('unclassified and high-risk requests are never hotkey eligible', () => {
  const broker = new PermissionBroker()
  broker.registerAdapter({
    id: 'a',
    capabilities: { permissions: 'respond', permissionModes: ['allow_once', 'deny'] },
    async respond() { return 'delivered' as const },
  })
  const make = (id: string, risk?: string) => broker.createRequest('a', {
    requestId: id, agentId: 'x', sessionId: 's', generation: 1, action: 'tool',
    description: 'd', responseHandle: {}, ...(risk ? { risk } : {}),
  })
  make('r-unknown')
  make('r-high', 'high')
  make('r-medium', 'medium')
  make('r-low', 'low')
  const byId = new Map(broker.listRequests().map((v) => [v.requestId, v]))
  assert.equal(byId.get('r-unknown')?.risk, 'unknown')
  assert.equal(byId.get('r-unknown')?.hotkeyEligible, false)
  assert.equal(byId.get('r-high')?.hotkeyEligible, false)
  assert.equal(byId.get('r-medium')?.hotkeyEligible, true)
  assert.equal(byId.get('r-low')?.hotkeyEligible, true)
  broker.shutdown()
})

test('Claude Code tools map to the Claude risk table; anything unlisted is unknown', () => {
  const expected: Record<string, string> = {
    Bash: 'high', Write: 'medium', Edit: 'medium', MultiEdit: 'medium', NotebookEdit: 'medium',
    WebFetch: 'high', WebSearch: 'high',
  }
  for (const [tool, risk] of Object.entries(expected)) assert.equal(classifyClaudeToolRisk(tool), risk, tool)
  // Case and prefixes matter: a renamed or MCP-wrapped tool never inherits a softer level.
  for (const tool of ['bash', 'write', 'mcp__fs__Write', 'mcp__github__create_issue', 'Task', 'Read', '', 'constructor', '__proto__', 'toString']) {
    assert.equal(classifyClaudeToolRisk(tool), 'unknown', tool)
  }
  assert.equal(isClaudeNetworkTool('WebFetch'), true)
  assert.equal(isClaudeNetworkTool('WebSearch'), true)
  assert.equal(isClaudeNetworkTool('Bash'), false)
})
