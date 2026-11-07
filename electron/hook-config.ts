import * as fs from 'node:fs'
import {
  ConfigRefusedError,
  type ConfigWriteResult,
  type JsonObject,
  isJsonObject,
  readJsonObjectConfig,
  serializeJson,
  writeConfigSafely,
} from './safe-config-write.ts'

// Electron-free hook-config editing shared by the installers in setup.ts.
// Every function here only ever touches Agent Pets' own entries.

type HookEntry = Record<string, unknown>

export function isAgentPetsHook(hook: unknown): boolean {
  if (!isJsonObject(hook) || hook.type !== 'command') return false
  const command = typeof hook.command === 'string' ? hook.command : ''
  const args = Array.isArray(hook.args) ? hook.args.join(' ') : ''
  const combined = `${command} ${args}`
  return combined.includes('agent-hook') && combined.includes('desktop-pet')
}

export function removeAgentPetsHooks(groups: unknown): unknown[] {
  if (!Array.isArray(groups)) return []
  const result: unknown[] = []
  for (const group of groups) {
    if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
      result.push(group)
      continue
    }
    const remaining = group.hooks.filter(hook => !isAgentPetsHook(hook))
    // Drop a group only when removing our handlers emptied it; keep user groups untouched.
    if (remaining.length === 0 && group.hooks.length > 0) continue
    result.push(remaining.length === group.hooks.length ? group : { ...group, hooks: remaining })
  }
  return result
}

function requireHooksObject(filePath: string, root: JsonObject): Record<string, unknown> {
  if (root.hooks === undefined) return {}
  if (!isJsonObject(root.hooks)) {
    throw new ConfigRefusedError('not_object', filePath, `${filePath} has a "hooks" value that is not an object; Agent Pets did not modify it.`)
  }
  return root.hooks
}

function requireEventArray(filePath: string, event: string, value: unknown): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ConfigRefusedError('not_object', filePath, `${filePath} has hooks.${event} that is not a list; Agent Pets did not modify it.`)
  }
  return value
}

/**
 * Adds (or refreshes) Agent Pets' hook handlers in a hooks-style JSON file while keeping every
 * other key and every user-defined hook. Missing files are created from `defaults`.
 * Throws ConfigRefusedError when the file exists but is not a parseable JSON object.
 */
export function mergeAgentPetsHooksFile(
  filePath: string,
  desired: Record<string, unknown[]>,
  defaults: JsonObject = {},
): ConfigWriteResult {
  const { exists, root } = readJsonObjectConfig(filePath)
  const base: JsonObject = exists ? root : { ...defaults }
  const hooks = requireHooksObject(filePath, base)
  for (const [event, handlers] of Object.entries(desired)) {
    const kept = removeAgentPetsHooks(requireEventArray(filePath, event, hooks[event]))
    hooks[event] = [...kept, handlers[0]]
  }
  base.hooks = hooks
  return writeConfigSafely(filePath, serializeJson(base))
}

export interface HookRemovalResult {
  status: 'removed' | 'absent' | 'deleted_file'
  path: string
  backupPath: string | null
}

/**
 * Removes only Agent Pets hook handlers. The file is deleted only when nothing but content that
 * Agent Pets itself wrote (`ownedTopLevel` key/value pairs) remains.
 */
export function removeAgentPetsHooksFile(
  filePath: string,
  ownedTopLevel: Record<string, unknown> = {},
): HookRemovalResult {
  const { exists, root } = readJsonObjectConfig(filePath)
  if (!exists) return { status: 'absent', path: filePath, backupPath: null }
  if (!isJsonObject(root.hooks)) return { status: 'absent', path: filePath, backupPath: null }
  const hooks = root.hooks
  let changed = false
  for (const event of Object.keys(hooks)) {
    const current = hooks[event]
    if (!Array.isArray(current)) continue
    const next = removeAgentPetsHooks(current)
    if (next.length !== current.length || JSON.stringify(next) !== JSON.stringify(current)) changed = true
    if (next.length === 0) delete hooks[event]
    else hooks[event] = next
  }
  if (!changed) return { status: 'absent', path: filePath, backupPath: null }
  if (Object.keys(hooks).length === 0) delete root.hooks

  for (const [key, value] of Object.entries(ownedTopLevel)) {
    if (root[key] === value) delete root[key]
  }

  if (Object.keys(root).length === 0) {
    // Everything left was written by Agent Pets: keep a backup, then remove the empty shell.
    const write = writeConfigSafely(filePath, serializeJson(root))
    fs.rmSync(filePath, { force: true })
    return { status: 'deleted_file', path: filePath, backupPath: write.backupPath }
  }
  const write = writeConfigSafely(filePath, serializeJson(root))
  return { status: 'removed', path: filePath, backupPath: write.backupPath }
}

/** True if the file contains at least one Agent Pets hook. Unreadable or invalid files report false. */
export function fileHasAgentPetsHooks(filePath: string): boolean {
  try {
    const { root } = readJsonObjectConfig(filePath)
    if (!isJsonObject(root.hooks)) return false
    return Object.values(root.hooks).some(groups => (
      Array.isArray(groups) && groups.some(group => (
        isJsonObject(group) && Array.isArray(group.hooks) && group.hooks.some(isAgentPetsHook)
      ))
    ))
  } catch {
    return false
  }
}

/**
 * Rewrites the command of already-installed Agent Pets hooks (Windows repair). Returns whether
 * anything changed. Unparseable files are left alone.
 */
export function rewriteAgentPetsHookCommands(
  filePath: string,
  rewrite: (hook: HookEntry) => boolean,
): boolean {
  let parsed: ReturnType<typeof readJsonObjectConfig>
  try {
    parsed = readJsonObjectConfig(filePath)
  } catch {
    return false
  }
  if (!parsed.exists || !isJsonObject(parsed.root.hooks)) return false
  let changed = false
  for (const groups of Object.values(parsed.root.hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        if (isAgentPetsHook(hook) && rewrite(hook as HookEntry)) changed = true
      }
    }
  }
  if (changed) writeConfigSafely(filePath, serializeJson(parsed.root))
  return changed
}

// ---- Claude Desktop config: single top-level key ----

export function setJsonKeyFile(filePath: string, key: string, value: unknown): ConfigWriteResult {
  const { root } = readJsonObjectConfig(filePath)
  if (JSON.stringify(root[key]) === JSON.stringify(value) && key in root) {
    return { status: 'unchanged', path: filePath, backupPath: null }
  }
  root[key] = value
  return writeConfigSafely(filePath, serializeJson(root))
}

/** Removes `key` only if its current value equals `expected` (i.e. we wrote it). */
export function removeJsonKeyFile(filePath: string, key: string, expected: unknown): HookRemovalResult {
  const { exists, root } = readJsonObjectConfig(filePath)
  if (!exists || !(key in root) || JSON.stringify(root[key]) !== JSON.stringify(expected)) {
    return { status: 'absent', path: filePath, backupPath: null }
  }
  delete root[key]
  const write = writeConfigSafely(filePath, serializeJson(root))
  return { status: 'removed', path: filePath, backupPath: write.backupPath }
}

// ---- Codex config.toml [features].hooks ----
// TOML has no parser dependency here, so the single key is patched line by line.

export function enableCodexHooksFeatureText(existing: string): { content: string, added: boolean } {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing
    .split(/\r?\n/)
    .filter(line => !/^\s*codex_hooks\s*=/.test(line))
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  const featuresIndex = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))
  let added = false

  if (featuresIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push('[features]')
    lines.push('hooks = true')
    added = true
  } else {
    let insertIndex = featuresIndex + 1
    let hooksIndex = -1
    for (let i = featuresIndex + 1; i < lines.length; i++) {
      if (/^\s*\[/.test(lines[i])) break
      insertIndex = i + 1
      if (/^\s*hooks\s*=/.test(lines[i])) hooksIndex = i
    }
    if (hooksIndex === -1) {
      lines.splice(insertIndex, 0, 'hooks = true')
      added = true
    } else {
      lines[hooksIndex] = 'hooks = true'
    }
  }

  return { content: lines.join(eol).replace(/(\r?\n)*$/, eol), added }
}

/** Removes the `hooks = true` line (and an emptied `[features]` table) that enableCodexHooksFeatureText added. */
export function disableCodexHooksFeatureText(existing: string): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing.split(/\r?\n/)
  const featuresIndex = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))
  if (featuresIndex === -1) return existing
  let end = featuresIndex + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1
  const body = lines.slice(featuresIndex + 1, end)
  const kept = body.filter(line => !/^\s*hooks\s*=\s*true\s*(#.*)?$/.test(line))
  if (kept.length === body.length) return existing
  const meaningful = kept.some(line => line.trim() !== '')
  const next = meaningful
    ? [...lines.slice(0, featuresIndex + 1), ...kept, ...lines.slice(end)]
    : [...lines.slice(0, featuresIndex), ...lines.slice(end)]
  const joined = next.join(eol).replace(/(\r?\n){3,}/g, `${eol}${eol}`)
  return joined.trim() === '' ? '' : joined.replace(/(\r?\n)*$/, eol)
}
