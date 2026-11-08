import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { renameSyncWithRetry } from './fs-rename.ts'
import { checkPanelThemeUserImage, PANEL_THEME_USER_IMAGE_MAX_BYTES, type PanelThemeImageKind } from './plugin-panel-themes.ts'
import { PANEL_THEME_USER_IMAGE_FILE } from './panel-theme-store.ts'

// User-imported panel background images (spec §4.3). The source file is read
// exactly once through a checked descriptor; every check runs on those bytes.
// Stored copies live in `userData/panel-theme-images/<pluginId>/<sha256>.<ext>`
// (directories 0o700, files 0o600), written as temp file + rename.

export const PANEL_THEME_IMAGES_DIRECTORY = 'panel-theme-images'
export const PANEL_THEME_SWEEP_LIMIT = 256

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const EXTENSION: Record<PanelThemeImageKind, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type UserImageReadError = 'image_invalid' | 'image_too_large'

export type UserImagePrepared =
  | { ok: true; bytes: Uint8Array; type: PanelThemeImageKind; width: number; height: number; sha256: string; file: string }
  | { ok: false; error: 'image_invalid' | 'image_too_large'; reason?: 'animated' }

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

/**
 * lstat (regular file, not a symlink, size cap), open with O_NOFOLLOW, fstat
 * (same dev/ino/size), then one read into memory.
 */
export async function readUserImageSource(filePath: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: UserImageReadError }> {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { ok: false, error: 'image_invalid' }
  let handle: fs.promises.FileHandle | null = null
  try {
    const linkStat = await fs.promises.lstat(filePath)
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) return { ok: false, error: 'image_invalid' }
    if (linkStat.size > PANEL_THEME_USER_IMAGE_MAX_BYTES) return { ok: false, error: 'image_too_large' }
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== linkStat.dev || opened.ino !== linkStat.ino || opened.size !== linkStat.size) {
      return { ok: false, error: 'image_invalid' }
    }
    const bytes = new Uint8Array(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== bytes.length) return { ok: false, error: 'image_invalid' }
    return { ok: true, bytes }
  } catch {
    return { ok: false, error: 'image_invalid' }
  } finally {
    try { await handle?.close() } catch {}
  }
}

/** Validates in-memory bytes (header only; never decodes) and names the stored copy. */
export function prepareUserImage(bytes: Uint8Array): UserImagePrepared {
  const check = checkPanelThemeUserImage(bytes)
  if (!check.ok) {
    return check.error === 'image_animated'
      ? { ok: false, error: 'image_invalid', reason: 'animated' }
      : { ok: false, error: check.error }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { ok: true, bytes, type: check.type, width: check.width, height: check.height, sha256, file: `${sha256}.${EXTENSION[check.type]}` }
}

function assertRealDirectory(directory: string): void {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('unsafe panel theme image directory')
}

function ensurePrivateDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (!isErrorCode(error, 'EEXIST')) throw error
  }
  assertRealDirectory(directory)
  if (process.platform !== 'win32') {
    try { fs.chmodSync(directory, 0o700) } catch {}
  }
}

export function panelThemeImagesRoot(userDataDirectory: string): string {
  return path.join(userDataDirectory, PANEL_THEME_IMAGES_DIRECTORY)
}

/** Directory for one plugin's images; null for an invalid id. */
export function panelThemePluginImageDirectory(userDataDirectory: string, pluginId: string): string | null {
  return PLUGIN_ID.test(pluginId) ? path.join(panelThemeImagesRoot(userDataDirectory), pluginId) : null
}

/** Writes the validated bytes as `<root>/<pluginId>/<sha256>.<ext>` (temp + rename). */
export function storeUserImage(userDataDirectory: string, pluginId: string, prepared: Extract<UserImagePrepared, { ok: true }>): void {
  const directory = panelThemePluginImageDirectory(userDataDirectory, pluginId)
  if (!directory || !PANEL_THEME_USER_IMAGE_FILE.test(prepared.file)) throw new TypeError('invalid panel theme image target')
  assertRealDirectory(userDataDirectory)
  ensurePrivateDirectory(panelThemeImagesRoot(userDataDirectory))
  ensurePrivateDirectory(directory)
  const target = path.join(directory, prepared.file)
  try {
    const existing = fs.lstatSync(target)
    // Content-addressed: an identical regular file is already in place.
    if (existing.isFile() && !existing.isSymbolicLink() && existing.size === prepared.bytes.byteLength) return
    if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError('unsafe panel theme image file')
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT')) throw error
  }
  const temporary = path.join(directory, `.${prepared.sha256}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, prepared.bytes, { mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, target)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
}

/** Deletes one stored image file (never follows a symlink). */
export function deleteUserImage(userDataDirectory: string, pluginId: string, file: string): void {
  const directory = panelThemePluginImageDirectory(userDataDirectory, pluginId)
  if (!directory || !PANEL_THEME_USER_IMAGE_FILE.test(file)) return
  try {
    assertRealDirectory(directory)
    const target = path.join(directory, file)
    const stat = fs.lstatSync(target)
    if (stat.isFile() || stat.isSymbolicLink()) fs.rmSync(target, { force: true })
  } catch {}
}

/** Removes `panel-theme-images/<pluginId>` after confirming it is a real directory. */
export function removePluginImages(userDataDirectory: string, pluginId: string): void {
  const directory = panelThemePluginImageDirectory(userDataDirectory, pluginId)
  if (!directory) return
  try {
    assertRealDirectory(panelThemeImagesRoot(userDataDirectory))
    const stat = fs.lstatSync(directory)
    if (stat.isSymbolicLink()) {
      fs.rmSync(directory, { force: true })
      return
    }
    if (stat.isDirectory()) fs.rmSync(directory, { recursive: true, force: true })
  } catch {}
}

/**
 * Startup sweep: deletes files the store does not reference (and stray temp
 * files). Bounded: at most PANEL_THEME_SWEEP_LIMIT directory entries examined.
 */
export function sweepOrphanUserImages(userDataDirectory: string, referenced: ReadonlySet<string>, limit = PANEL_THEME_SWEEP_LIMIT): number {
  const root = panelThemeImagesRoot(userDataDirectory)
  let examined = 0
  let removed = 0
  try {
    assertRealDirectory(root)
  } catch {
    return 0
  }
  let plugins: fs.Dirent[]
  try { plugins = fs.readdirSync(root, { withFileTypes: true }) } catch { return 0 }
  for (const plugin of plugins) {
    if (examined >= limit) break
    examined += 1
    const pluginDirectory = path.join(root, plugin.name)
    if (!plugin.isDirectory() || plugin.isSymbolicLink() || !PLUGIN_ID.test(plugin.name)) {
      try { fs.rmSync(pluginDirectory, { force: true, recursive: plugin.isDirectory() && !plugin.isSymbolicLink() }) } catch {}
      removed += 1
      continue
    }
    let files: fs.Dirent[]
    try { files = fs.readdirSync(pluginDirectory, { withFileTypes: true }) } catch { continue }
    for (const file of files) {
      if (examined >= limit) break
      examined += 1
      if (file.isFile() && PANEL_THEME_USER_IMAGE_FILE.test(file.name) && referenced.has(`${plugin.name}/${file.name}`)) continue
      try {
        fs.rmSync(path.join(pluginDirectory, file.name), { force: true, recursive: file.isDirectory() && !file.isSymbolicLink() })
        removed += 1
      } catch {}
    }
    try {
      if (fs.readdirSync(pluginDirectory).length === 0) fs.rmdirSync(pluginDirectory)
    } catch {}
  }
  return removed
}
