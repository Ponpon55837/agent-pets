import { randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { parseUserPanelThemeDefinition, parseUserPanelThemeName, parseUserPanelThemeRecord } from './panel-theme-user.ts'
import { validateUserPanelTheme } from './panel-theme-diagnostics.ts'
import {
  USER_PANEL_THEME_MAX_BYTES,
  USER_PANEL_THEME_MAX_COUNT,
  USER_PANEL_THEME_SCHEMA_VERSION,
  isUserPanelThemeId,
  type PanelThemeValidation,
  type UserPanelThemeDefinition,
  type UserPanelThemeRecord,
} from '../src/types/panel-theme-user.ts'

// 「我的主題」的儲存（spec R22）：`userData/panel-themes-user/<id>.json`，一個主題一個檔案。
// 目錄 0o700、檔案 0o600，暫存檔 + rename 原子寫入；讀取時拒絕 symlink 與非一般檔案、
// O_NOFOLLOW 開啟並以 fstat 比對 dev/ino，大小有上限。損毀的檔案改名備份後略過，
// 不會讓其他主題消失。每次寫入前都以和插件主題相同的驗證器檢查定義。

export const USER_PANEL_THEMES_DIRECTORY = 'panel-themes-user'
const FILE_NAME = /^(u-[0-9a-f]{12})\.json$/
const TEMPORARY_FILE = /^\.u-[0-9a-f]{12}\.[0-9a-f-]{36}\.tmp$/
/** 啟動時最多檢查的目錄項目數（主題上限的兩倍再加一點，給備份與暫存檔）。 */
export const USER_PANEL_THEME_SCAN_LIMIT = USER_PANEL_THEME_MAX_COUNT * 2 + 16

export type UserPanelThemeStoreErrorCode = 'unsafe_directory' | 'limit_reached' | 'not_found' | 'too_large' | 'invalid_definition' | 'invalid_name'

export class UserPanelThemeStoreError extends Error {
  readonly code: UserPanelThemeStoreErrorCode
  readonly validation?: PanelThemeValidation

  constructor(code: UserPanelThemeStoreErrorCode, validation?: PanelThemeValidation) {
    super(`User panel theme store: ${code}`)
    this.name = 'UserPanelThemeStoreError'
    this.code = code
    if (validation) this.validation = validation
  }
}

export interface UserPanelThemeStoreOptions {
  now?: () => number
  /** 產生新 id 的 12 個十六進位字元（測試可注入）。 */
  randomHex?: () => string
  /** 驗證器；預設為 validateUserPanelTheme（IPC 傳入有快取的版本）。 */
  validate?: (definition: unknown) => PanelThemeValidation
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

/** 讀取一個一般檔案：不跟隨 symlink、大小有上限、開啟後與 lstat 比對是同一個檔案。 */
function readRegularJson(filePath: string): { ok: true; value: unknown } | { ok: false; corrupt: boolean } {
  let linkStat: fs.Stats
  try {
    linkStat = fs.lstatSync(filePath)
  } catch {
    return { ok: false, corrupt: false }
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) return { ok: false, corrupt: false }
  if (linkStat.size > USER_PANEL_THEME_MAX_BYTES) return { ok: false, corrupt: true }
  let descriptor: number | null = null
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.dev !== linkStat.dev || stat.ino !== linkStat.ino) return { ok: false, corrupt: false }
    if (stat.size > USER_PANEL_THEME_MAX_BYTES) return { ok: false, corrupt: true }
    try {
      return { ok: true, value: JSON.parse(fs.readFileSync(descriptor, 'utf8')) as unknown }
    } catch {
      return { ok: false, corrupt: true }
    }
  } catch {
    return { ok: false, corrupt: false }
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function compareRecords(first: UserPanelThemeRecord, second: UserPanelThemeRecord): number {
  return first.createdAt < second.createdAt ? -1 : first.createdAt > second.createdAt ? 1 : first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

export class UserPanelThemeStore {
  readonly directory: string
  private records: Map<string, UserPanelThemeRecord> | null = null
  private unsafe = false
  private readonly now: () => number
  private readonly randomHex: () => string
  private readonly validate: (definition: unknown) => PanelThemeValidation

  constructor(userDataDirectory: string, options: UserPanelThemeStoreOptions = {}) {
    if (!path.isAbsolute(userDataDirectory)) throw new TypeError('User panel theme store requires an absolute userData directory')
    this.directory = path.join(userDataDirectory, USER_PANEL_THEMES_DIRECTORY)
    this.now = options.now ?? Date.now
    this.randomHex = options.randomHex ?? (() => randomBytes(6).toString('hex'))
    this.validate = options.validate ?? validateUserPanelTheme
  }

  /** 依建立時間排序的所有主題（複本）。目錄不安全時為空。 */
  list(): UserPanelThemeRecord[] {
    return [...this.load().values()].sort(compareRecords).map(record => structuredClone(record))
  }

  get(id: string): UserPanelThemeRecord | null {
    const record = isUserPanelThemeId(id) ? this.load().get(id) : undefined
    return record ? structuredClone(record) : null
  }

  isUnsafe(): boolean {
    this.load()
    return this.unsafe
  }

  create(name: unknown, definition: unknown): UserPanelThemeRecord {
    const records = this.load()
    if (records.size >= USER_PANEL_THEME_MAX_COUNT) throw new UserPanelThemeStoreError('limit_reached')
    const cleanName = this.requireName(name)
    const cleanDefinition = this.requireDefinition(definition)
    let id = `u-${this.randomHex()}`
    // 碰撞機率極低；仍保證不覆寫既有主題。
    while (records.has(id) || !isUserPanelThemeId(id)) id = `u-${randomBytes(6).toString('hex')}`
    const timestamp = new Date(this.now()).toISOString()
    const record: UserPanelThemeRecord = { schemaVersion: USER_PANEL_THEME_SCHEMA_VERSION, id, name: cleanName, createdAt: timestamp, updatedAt: timestamp, definition: cleanDefinition }
    this.write(record)
    return structuredClone(record)
  }

  update(id: unknown, definition: unknown): UserPanelThemeRecord {
    const current = this.require(id)
    return this.replace({ ...current, definition: this.requireDefinition(definition) })
  }

  rename(id: unknown, name: unknown): UserPanelThemeRecord {
    const current = this.require(id)
    return this.replace({ ...current, name: this.requireName(name) })
  }

  duplicate(id: unknown, name: unknown): UserPanelThemeRecord {
    const current = this.require(id)
    return this.create(name, current.definition)
  }

  /** 刪除一個主題；不存在時回傳 false。 */
  delete(id: unknown): boolean {
    if (!isUserPanelThemeId(id)) return false
    const records = this.load()
    if (!records.has(id)) return false
    this.assertDirectory()
    const target = path.join(this.directory, `${id}.json`)
    try {
      const stat = fs.lstatSync(target)
      // rm 不會跟隨 symlink：連結本身被移除，目標不受影響。
      if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(target, { force: true })
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    records.delete(id)
    return true
  }

  private require(id: unknown): UserPanelThemeRecord {
    const record = isUserPanelThemeId(id) ? this.load().get(id) : undefined
    if (!record) throw new UserPanelThemeStoreError('not_found')
    return record
  }

  private requireName(name: unknown): string {
    const clean = parseUserPanelThemeName(name)
    if (!clean) throw new UserPanelThemeStoreError('invalid_name')
    return clean
  }

  /** 結構解析之後再以完整驗證器檢查；任何問題都拒絕寫入。 */
  private requireDefinition(definition: unknown): UserPanelThemeDefinition {
    const parsed = parseUserPanelThemeDefinition(definition)
    const validation = this.validate(parsed.ok ? parsed.value : definition)
    if (!parsed.ok || !validation.valid) throw new UserPanelThemeStoreError('invalid_definition', validation)
    return parsed.value
  }

  private replace(record: UserPanelThemeRecord): UserPanelThemeRecord {
    const next: UserPanelThemeRecord = { ...record, updatedAt: new Date(Math.max(this.now(), Date.parse(record.createdAt))).toISOString() }
    this.write(next)
    return structuredClone(next)
  }

  private load(): Map<string, UserPanelThemeRecord> {
    if (this.records) return this.records
    const records = new Map<string, UserPanelThemeRecord>()
    this.records = records
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(this.directory)
    } catch (error) {
      this.unsafe = !isErrorCode(error, 'ENOENT')
      return records
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      this.unsafe = true
      return records
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(this.directory, { withFileTypes: true }).slice(0, USER_PANEL_THEME_SCAN_LIMIT)
    } catch {
      this.unsafe = true
      return records
    }
    const loaded: UserPanelThemeRecord[] = []
    for (const entry of entries) {
      const filePath = path.join(this.directory, entry.name)
      if (TEMPORARY_FILE.test(entry.name) && entry.isFile()) {
        // 上次寫到一半就結束留下的暫存檔。
        try { fs.rmSync(filePath, { force: true }) } catch {}
        continue
      }
      const match = FILE_NAME.exec(entry.name)
      if (!match) continue
      const read = readRegularJson(filePath)
      const record = read.ok ? parseUserPanelThemeRecord(read.value, match[1]!) : null
      if (record) {
        loaded.push(record)
      } else if (read.ok || read.corrupt) {
        this.backupCorrupt(filePath)
      }
    }
    for (const record of loaded.sort(compareRecords).slice(0, USER_PANEL_THEME_MAX_COUNT)) records.set(record.id, record)
    return records
  }

  /** 損毀的檔案改名成 `<id>.json.corrupt-<時間>`（不再符合檔名規則，之後不會被讀取）。 */
  private backupCorrupt(filePath: string): void {
    let timestamp = this.now()
    let backup = `${filePath}.corrupt-${timestamp}`
    while (fs.existsSync(backup)) {
      timestamp += 1
      backup = `${filePath}.corrupt-${timestamp}`
    }
    try { renameSyncWithRetry(filePath, backup) } catch {}
  }

  private assertDirectory(): void {
    if (this.unsafe) throw new UserPanelThemeStoreError('unsafe_directory')
    const stat = fs.lstatSync(this.directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new UserPanelThemeStoreError('unsafe_directory')
  }

  private ensureDirectory(): void {
    if (this.unsafe) throw new UserPanelThemeStoreError('unsafe_directory')
    try {
      fs.mkdirSync(this.directory, { mode: 0o700 })
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error
    }
    this.assertDirectory()
    if (process.platform !== 'win32') {
      try { fs.chmodSync(this.directory, 0o700) } catch {}
    }
  }

  private write(record: UserPanelThemeRecord): void {
    const encoded = JSON.stringify(record)
    if (Buffer.byteLength(encoded, 'utf8') > USER_PANEL_THEME_MAX_BYTES) throw new UserPanelThemeStoreError('too_large')
    this.ensureDirectory()
    const target = path.join(this.directory, `${record.id}.json`)
    try {
      const existing = fs.lstatSync(target)
      if (existing.isSymbolicLink() || !existing.isFile()) throw new UserPanelThemeStoreError('unsafe_directory')
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error
    }
    const temporary = path.join(this.directory, `.${record.id}.${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSyncWithRetry(temporary, target)
      if (process.platform !== 'win32') {
        try { fs.chmodSync(target, 0o600) } catch {}
      }
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }) } catch {}
      throw error
    }
    this.load().set(record.id, structuredClone(record))
  }
}
