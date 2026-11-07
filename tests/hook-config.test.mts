import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  disableCodexHooksFeatureText,
  enableCodexHooksFeatureText,
  fileHasAgentPetsHooks,
  mergeAgentPetsHooksFile,
  removeAgentPetsHooksFile,
  removeJsonKeyFile,
  setJsonKeyFile,
} from '../electron/hook-config.ts'
import {
  BACKUP_MARKER,
  ConfigRefusedError,
  listBackups,
  writeConfigSafely,
  writeTextAtomic,
} from '../electron/safe-config-write.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-hook-config-'))
}

const HOOK = '/home/u/.desktop-pet/agent-hook.mjs'
function ours(extra: Record<string, unknown> = {}) {
  return { hooks: [{ type: 'command', command: 'node', args: [HOOK, 'claude'] }], ...extra }
}
function desired() {
  return { SessionStart: [ours()], Stop: [ours()] }
}

test('merge refuses unparseable JSON and leaves the file untouched', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    const original = '{ "model": "opus", // comment\n "permissions": {} }'
    fs.writeFileSync(file, original)
    assert.throws(() => mergeAgentPetsHooksFile(file, desired()), (error: unknown) => (
      error instanceof ConfigRefusedError && error.code === 'unparseable' && error.message.includes(file)
    ))
    assert.equal(fs.readFileSync(file, 'utf8'), original)
    assert.deepEqual(listBackups(file), [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('merge refuses non-object roots and malformed hooks values', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '[1,2]')
    assert.throws(() => mergeAgentPetsHooksFile(file, desired()), ConfigRefusedError)
    fs.writeFileSync(file, '{"hooks": "nope"}')
    assert.throws(() => mergeAgentPetsHooksFile(file, desired()), ConfigRefusedError)
    fs.writeFileSync(file, '{"hooks": {"Stop": "nope"}}')
    assert.throws(() => mergeAgentPetsHooksFile(file, desired()), ConfigRefusedError)
    assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks": {"Stop": "nope"}}')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('merge keeps user keys and hooks, backs up, and is idempotent', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    const user = { model: 'opus', permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }
    fs.writeFileSync(file, JSON.stringify(user))

    const first = mergeAgentPetsHooksFile(file, desired())
    assert.equal(first.status, 'written')
    assert.ok(first.backupPath && fs.existsSync(first.backupPath))
    assert.equal(first.backupPath && JSON.parse(fs.readFileSync(first.backupPath, 'utf8')).model, 'opus')
    const merged = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(merged.model, 'opus')
    assert.deepEqual(merged.permissions, user.permissions)
    assert.equal(merged.hooks.Stop.length, 2)
    assert.equal(merged.hooks.Stop[0].hooks[0].command, 'echo hi')
    assert.equal(merged.hooks.SessionStart.length, 1)

    const second = mergeAgentPetsHooksFile(file, desired())
    assert.equal(second.status, 'unchanged')
    assert.equal(second.backupPath, null)
    assert.equal(listBackups(file).length, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('merge creates a missing file from defaults without a backup', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'nested', 'hooks.json')
    const result = mergeAgentPetsHooksFile(file, desired(), { description: 'Agent Pets' })
    assert.equal(result.backupPath, null)
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(written.description, 'Agent Pets')
    assert.ok(fileHasAgentPetsHooks(file))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('merge treats an empty file as an empty object', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '')
    mergeAgentPetsHooksFile(file, desired())
    assert.ok(fileHasAgentPetsHooks(file))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('backups are pruned to the most recent entries', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'a.json')
    fs.writeFileSync(file, '{}')
    for (let index = 0; index < 8; index += 1) writeConfigSafely(file, `{"n":${index}}\n`)
    const backups = listBackups(file)
    assert.equal(backups.length, 5)
    assert.ok(backups.every(name => path.basename(name).includes(BACKUP_MARKER)))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('writes go through a symlink to the real target and preserve file mode', { skip: process.platform === 'win32' }, () => {
  const dir = tempDir()
  try {
    const real = path.join(dir, 'real.json')
    const link = path.join(dir, 'link.json')
    fs.writeFileSync(real, '{}', { mode: 0o640 })
    fs.chmodSync(real, 0o640)
    fs.symlinkSync(real, link)
    mergeAgentPetsHooksFile(link, desired())
    assert.ok(fs.lstatSync(link).isSymbolicLink())
    assert.ok(fileHasAgentPetsHooks(real))
    assert.equal(fs.statSync(real).mode & 0o777, 0o640)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('concurrent atomic writers never leave a partial file', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'x.json')
    for (let index = 0; index < 20; index += 1) writeTextAtomic(file, JSON.stringify({ index }))
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { index: 19 })
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('remove only strips Agent Pets hooks and keeps user hooks and keys', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }))
    mergeAgentPetsHooksFile(file, desired())
    const result = removeAgentPetsHooksFile(file)
    assert.equal(result.status, 'removed')
    const after = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(after.model, 'opus')
    assert.deepEqual(Object.keys(after.hooks), ['Stop'])
    assert.equal(after.hooks.Stop[0].hooks[0].command, 'echo hi')
    assert.equal(removeAgentPetsHooksFile(file).status, 'absent')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('remove deletes a hooks file that only contained Agent Pets content', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'hooks.json')
    mergeAgentPetsHooksFile(file, desired(), { description: 'Agent Pets' })
    const result = removeAgentPetsHooksFile(file, { description: 'Agent Pets' })
    assert.equal(result.status, 'deleted_file')
    assert.equal(fs.existsSync(file), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('remove refuses to touch an unparseable file', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{ broken')
    assert.throws(() => removeAgentPetsHooksFile(file), ConfigRefusedError)
    assert.equal(fs.readFileSync(file, 'utf8'), '{ broken')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('single-key helpers only remove a value Agent Pets wrote', () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'claude_desktop_config.json')
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: 1 } }))
    assert.equal(setJsonKeyFile(file, 'agent', HOOK).status, 'written')
    assert.equal(setJsonKeyFile(file, 'agent', HOOK).status, 'unchanged')
    assert.equal(removeJsonKeyFile(file, 'agent', '/something/else').status, 'absent')
    assert.equal(removeJsonKeyFile(file, 'agent', HOOK).status, 'removed')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { a: 1 } })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('codex feature text: enable adds once, disable reverts only that line', () => {
  const fresh = enableCodexHooksFeatureText('')
  assert.equal(fresh.added, true)
  assert.equal(fresh.content, '[features]\nhooks = true\n')
  assert.equal(disableCodexHooksFeatureText(fresh.content), '')

  const base = 'model = "x"\n\n[features]\nother = true\n\n[tui]\nx = 1\n'
  const enabled = enableCodexHooksFeatureText(base)
  assert.equal(enabled.added, true)
  assert.ok(enabled.content.includes('hooks = true'))
  const reverted = disableCodexHooksFeatureText(enabled.content)
  assert.equal(reverted, base)

  const already = enableCodexHooksFeatureText('[features]\nhooks = false\n')
  assert.equal(already.added, false)
  assert.equal(already.content, '[features]\nhooks = true\n')
})

test('removing Codex hooks leaves Claude Code hooks (shared script) intact', () => {
  const dir = tempDir()
  try {
    const codex = path.join(dir, 'hooks.json')
    const claude = path.join(dir, 'settings.json')
    fs.writeFileSync(codex, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }))
    mergeAgentPetsHooksFile(codex, desired())
    mergeAgentPetsHooksFile(claude, desired())
    removeAgentPetsHooksFile(codex, { description: 'Agent Pets lifecycle hooks for Codex CLI.' })
    assert.equal(fileHasAgentPetsHooks(codex), false)
    assert.equal(fileHasAgentPetsHooks(claude), true)
    const kept = JSON.parse(fs.readFileSync(codex, 'utf8'))
    assert.equal(kept.hooks.Stop[0].hooks[0].command, 'echo mine')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

import { configuredHookExecutable, isCodexHooksFeatureEnabled, leadingExecutable } from '../electron/hook-config.ts'

test('codex hooks feature requires an explicit hooks = true under [features]', () => {
  assert.equal(isCodexHooksFeatureEnabled(null), false)
  assert.equal(isCodexHooksFeatureEnabled('model = "x"\n'), false)
  assert.equal(isCodexHooksFeatureEnabled('[features]\nother = true\n'), false)
  assert.equal(isCodexHooksFeatureEnabled('[features]\nhooks = false\n'), false)
  assert.equal(isCodexHooksFeatureEnabled('[features]\nhooks = true # on\n'), true)
  assert.equal(isCodexHooksFeatureEnabled('[tui]\nhooks = true\n[features]\n'), false)
})

test('configured hook executable is read from exec-form and shell-form hooks', () => {
  const dir = tempDir()
  try {
    const exec = path.join(dir, 'a.json')
    fs.writeFileSync(exec, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/opt/node', args: [HOOK, 'claude'] }] }] } }))
    assert.equal(configuredHookExecutable(exec), '/opt/node')
    const shell = path.join(dir, 'b.json')
    fs.writeFileSync(shell, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `"/opt/my node/node" "${HOOK}" codex` }] }] } }))
    assert.equal(configuredHookExecutable(shell), '/opt/my node/node')
    assert.equal(configuredHookExecutable(path.join(dir, 'missing.json')), null)
    assert.equal(leadingExecutable('node /x/.desktop-pet/agent-hook.mjs codex'), 'node')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
