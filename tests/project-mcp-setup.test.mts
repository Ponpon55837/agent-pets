import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { installProjectMcp } from '../electron/project-mcp-setup.ts'

function createProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-project-mcp-'))
}

function options(projectPath: string) {
  return {
    nodeExecutable: path.join(projectPath, 'node.exe'),
    bridgePath: path.join(projectPath, '.desktop-pet', 'presentation-mcp.mjs'),
  }
}

function cleanup(projectPath: string): void {
  fs.rmSync(projectPath, { recursive: true, force: true })
}

test('installs all supported project MCP configs and is idempotent', () => {
  const projectPath = createProject()
  try {
    const first = installProjectMcp(projectPath, options(projectPath))
    assert.equal(first.ok, true)
    assert.deepEqual(first.results.map(result => result.status), [
      'installed',
      'installed',
      'installed',
    ])

    const claude = JSON.parse(fs.readFileSync(path.join(projectPath, '.mcp.json'), 'utf8'))
    assert.equal(claude.mcpServers['agent-pets'].type, 'stdio')
    assert.deepEqual(claude.mcpServers['agent-pets'].args, [options(projectPath).bridgePath])

    const opencode = JSON.parse(fs.readFileSync(path.join(projectPath, 'opencode.json'), 'utf8'))
    assert.equal(opencode.mcp.servers['agent-pets'].type, 'local')
    assert.deepEqual(opencode.mcp.servers['agent-pets'].command, [
      options(projectPath).nodeExecutable,
      options(projectPath).bridgePath,
    ])

    const codex = fs.readFileSync(path.join(projectPath, '.codex', 'config.toml'), 'utf8')
    assert.match(codex, /\[mcp_servers\.agent-pets\]/)
    assert.match(codex, /command =/)

    const second = installProjectMcp(projectPath, options(projectPath))
    assert.equal(second.ok, true)
    assert.deepEqual(second.results.map(result => result.status), [
      'already_configured',
      'already_configured',
      'already_configured',
    ])
  } finally {
    cleanup(projectPath)
  }
})

test('does not overwrite a conflicting project server', () => {
  const projectPath = createProject()
  try {
    const configPath = path.join(projectPath, '.mcp.json')
    const original = {
      mcpServers: {
        'agent-pets': {
          type: 'stdio',
          command: 'some-other-node',
          args: ['some-other-server.mjs'],
        },
      },
    }
    fs.writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    const result = installProjectMcp(projectPath, options(projectPath))
    const claudeResult = result.results.find(item => item.client === 'claude')
    assert.equal(result.ok, false)
    assert.equal(claudeResult?.status, 'conflict')
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), original)
  } finally {
    cleanup(projectPath)
  }
})

test('reports invalid JSON without modifying the invalid file', () => {
  const projectPath = createProject()
  try {
    const configPath = path.join(projectPath, 'opencode.json')
    const original = '{"mcp":\n'
    fs.writeFileSync(configPath, original, 'utf8')

    const result = installProjectMcp(projectPath, options(projectPath))
    const opencodeResult = result.results.find(item => item.client === 'opencode')
    assert.equal(opencodeResult?.status, 'error')
    assert.equal(fs.readFileSync(configPath, 'utf8'), original)
  } finally {
    cleanup(projectPath)
  }
})

test('fails closed for an unsafe project config directory', () => {
  const projectPath = createProject()
  try {
    fs.writeFileSync(path.join(projectPath, '.codex'), 'not a directory', 'utf8')
    const result = installProjectMcp(projectPath, options(projectPath))
    const codexResult = result.results.find(item => item.client === 'codex')
    assert.equal(codexResult?.status, 'error')
    assert.equal(fs.readFileSync(path.join(projectPath, '.codex'), 'utf8'), 'not a directory')
  } finally {
    cleanup(projectPath)
  }
})

test('requires absolute executable and bridge paths', () => {
  const projectPath = createProject()
  try {
    assert.throws(
      () => installProjectMcp(projectPath, { nodeExecutable: 'node', bridgePath: 'bridge.mjs' }),
      /absolute Node\.js and bridge paths/,
    )
  } finally {
    cleanup(projectPath)
  }
})
