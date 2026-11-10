import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { pidTimestampTemporaryPath, writeFileAtomic, writeFileAtomicSync } from './atomic-file-write.ts'

// Shared, Electron-free helpers for touching configuration files that belong to
// the user (~/.claude/settings.json, ~/.codex/hooks.json, ...). The rules:
//   1. never overwrite a file we cannot parse,
//   2. back the file up before changing it,
//   3. write through a temp file + rename so a crash never leaves half a file,
//   4. report "unchanged" instead of rewriting identical content.

export const BACKUP_MARKER = '.agent-pets-bak-'
export const MAX_BACKUPS = 5
export const MAX_CONFIG_BYTES = 1024 * 1024

export type ConfigRefusalCode = 'unparseable' | 'not_object' | 'unsafe' | 'too_large'

export class ConfigRefusedError extends Error {
  readonly code: ConfigRefusalCode
  readonly filePath: string

  constructor(code: ConfigRefusalCode, filePath: string, message: string) {
    super(message)
    this.name = 'ConfigRefusedError'
    this.code = code
    this.filePath = filePath
  }
}

export interface ConfigWriteResult {
  status: 'written' | 'unchanged'
  path: string
  backupPath: string | null
}

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Follow a symlinked dotfile (common for dotfile managers) to its real target so
// the rename replaces the target, not the link.
function resolveWriteTarget(filePath: string): string {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) return fs.realpathSync(filePath)
  } catch { /* missing file: write in place */ }
  return filePath
}

async function resolveWriteTargetAsync(filePath: string): Promise<string> {
  try {
    if ((await fsp.lstat(filePath)).isSymbolicLink()) return await fsp.realpath(filePath)
  } catch { /* missing file: write in place */ }
  return filePath
}

export function writeTextAtomic(filePath: string, content: string, options: { mode?: number } = {}): void {
  const target = resolveWriteTarget(filePath)
  const directory = path.dirname(target)
  fs.mkdirSync(directory, { recursive: true })

  let mode = options.mode
  if (mode === undefined) {
    try { mode = fs.statSync(target).mode & 0o777 } catch { /* new file */ }
  }

  writeFileAtomicSync(target, content, { temporaryPath: pidTimestampTemporaryPath(target), mode, enforceMode: true })
}

/** 與 writeTextAtomic 規則相同的非同步版（symlink 追隨、沿用既有權限、同目錄暫存檔）。 */
export async function writeTextAtomicAsync(filePath: string, content: string, options: { mode?: number } = {}): Promise<void> {
  const target = await resolveWriteTargetAsync(filePath)
  const directory = path.dirname(target)
  await fsp.mkdir(directory, { recursive: true })

  let mode = options.mode
  if (mode === undefined) {
    try { mode = (await fsp.stat(target)).mode & 0o777 } catch { /* new file */ }
  }

  await writeFileAtomic(target, content, { temporaryPath: pidTimestampTemporaryPath(target), mode, enforceMode: true })
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// 同步／非同步版共用的純函式，備份命名與保留規則只有這一份。
function backupPathsFrom(filePath: string, names: readonly string[]): string[] {
  const directory = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}${BACKUP_MARKER}`
  return names
    .filter(name => name.startsWith(prefix))
    .sort()
    .map(name => path.join(directory, name))
}

function staleBackupPaths(backups: readonly string[], keep: number): string[] {
  return backups.slice(0, Math.max(0, backups.length - keep))
}

function backupBasePath(source: string): string {
  return path.join(path.dirname(source), `${path.basename(source)}${BACKUP_MARKER}${backupTimestamp()}`)
}

export function listBackups(filePath: string): string[] {
  try {
    return backupPathsFrom(filePath, fs.readdirSync(path.dirname(filePath)))
  } catch {
    return []
  }
}

export async function listBackupsAsync(filePath: string): Promise<string[]> {
  try {
    return backupPathsFrom(filePath, await fsp.readdir(path.dirname(filePath)))
  } catch {
    return []
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/** Copies the file next to itself and prunes older backups. Returns null when there is nothing to back up. */
export function backupConfig(filePath: string, keep = MAX_BACKUPS): string | null {
  const source = resolveWriteTarget(filePath)
  if (!fs.existsSync(source)) return null
  const base = backupBasePath(source)
  let backupPath = base
  for (let suffix = 1; fs.existsSync(backupPath); suffix += 1) {
    backupPath = `${base}-${suffix}`
  }
  // Created 0600 from the start (a copy-then-chmod leaves a window where a secret-bearing
  // config backup is readable by others).
  fs.writeFileSync(backupPath, fs.readFileSync(source), { flag: 'wx', mode: 0o600 })
  for (const stale of staleBackupPaths(listBackups(source), keep)) {
    try { fs.rmSync(stale, { force: true }) } catch { /* ignore */ }
  }
  return backupPath
}

export async function backupConfigAsync(filePath: string, keep = MAX_BACKUPS): Promise<string | null> {
  const source = await resolveWriteTargetAsync(filePath)
  if (!(await pathExists(source))) return null
  const base = backupBasePath(source)
  let backupPath = base
  for (let suffix = 1; await pathExists(backupPath); suffix += 1) {
    backupPath = `${base}-${suffix}`
  }
  await fsp.writeFile(backupPath, await fsp.readFile(source), { flag: 'wx', mode: 0o600 })
  for (const stale of staleBackupPaths(await listBackupsAsync(source), keep)) {
    try { await fsp.rm(stale, { force: true }) } catch { /* ignore */ }
  }
  return backupPath
}

function assertReadableConfigStat(filePath: string, stat: { isFile(): boolean, size: number }): void {
  if (!stat.isFile()) {
    throw new ConfigRefusedError('unsafe', filePath, `${filePath} is not a regular file; Agent Pets did not modify it.`)
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new ConfigRefusedError(
      'too_large',
      filePath,
      `${filePath} is ${stat.size} bytes, above the ${MAX_CONFIG_BYTES} byte limit; Agent Pets did not modify it.`,
    )
  }
}

/** Reads a user config file as bounded text. Returns null when it does not exist. */
export function readConfigText(filePath: string): string | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  assertReadableConfigStat(filePath, stat)
  return fs.readFileSync(filePath, 'utf8')
}

export async function readConfigTextAsync(filePath: string): Promise<string | null> {
  let stat: fs.Stats
  try {
    stat = await fsp.stat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  assertReadableConfigStat(filePath, stat)
  return fsp.readFile(filePath, 'utf8')
}

/**
 * Parses an existing JSON object config strictly. A missing or blank file yields an empty
 * object; anything else that is not a valid JSON object (including JSONC with comments or
 * trailing commas) is refused instead of being replaced.
 */
export function readJsonObjectConfig(filePath: string): ParsedJsonConfig {
  return parseJsonObjectConfig(filePath, readConfigText(filePath))
}

export async function readJsonObjectConfigAsync(filePath: string): Promise<ParsedJsonConfig> {
  return parseJsonObjectConfig(filePath, await readConfigTextAsync(filePath))
}

export type ParsedJsonConfig = { exists: boolean, root: JsonObject, raw: string | null }

function parseJsonObjectConfig(filePath: string, raw: string | null): ParsedJsonConfig {
  if (raw === null) return { exists: false, root: {}, raw: null }
  const text = raw.replace(/^﻿/, '')
  if (text.trim() === '') return { exists: true, root: {}, raw }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ConfigRefusedError(
      'unparseable',
      filePath,
      `${filePath} is not valid JSON (comments and trailing commas are not supported); Agent Pets did not modify it.`,
    )
  }
  if (!isJsonObject(parsed)) {
    throw new ConfigRefusedError(
      'not_object',
      filePath,
      `${filePath} does not contain a JSON object; Agent Pets did not modify it.`,
    )
  }
  return { exists: true, root: parsed, raw }
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Backup-then-atomic-write; identical content is reported as unchanged and nothing is touched. */
export function writeConfigSafely(filePath: string, content: string): ConfigWriteResult {
  let existing: string | null = null
  try { existing = fs.readFileSync(resolveWriteTarget(filePath), 'utf8') } catch { /* new file */ }
  if (existing === content) return { status: 'unchanged', path: filePath, backupPath: null }
  const backupPath = existing !== null ? backupConfig(filePath) : null
  writeTextAtomic(filePath, content)
  return { status: 'written', path: filePath, backupPath }
}

export async function writeConfigSafelyAsync(filePath: string, content: string): Promise<ConfigWriteResult> {
  let existing: string | null = null
  try { existing = await fsp.readFile(await resolveWriteTargetAsync(filePath), 'utf8') } catch { /* new file */ }
  if (existing === content) return { status: 'unchanged', path: filePath, backupPath: null }
  const backupPath = existing !== null ? await backupConfigAsync(filePath) : null
  await writeTextAtomicAsync(filePath, content)
  return { status: 'written', path: filePath, backupPath }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
