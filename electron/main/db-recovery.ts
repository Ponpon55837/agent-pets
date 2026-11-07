import * as fs from 'node:fs'

export interface DbRecoveryOptions {
  now?: () => number
  log?: (message: string, detail?: unknown) => void
}

/**
 * Opens a SQLite-backed store. If opening fails (corruption, bad schema), the
 * database files are renamed aside as `<name>.corrupt-<timestamp>` so nothing
 * is lost, and a fresh database is created. Returns null if even that fails.
 */
export function openWithCorruptionRecovery<T>(
  databasePath: string,
  open: () => T,
  options: DbRecoveryOptions = {},
): T | null {
  const log = options.log ?? (() => {})
  try {
    return open()
  } catch (error) {
    log(`Database open failed; moving ${databasePath.split(/[\\/]/).pop()} aside and recreating`, error)
  }
  const stamp = (options.now ?? Date.now)()
  let moved = false
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.renameSync(`${databasePath}${suffix}`, `${databasePath}.corrupt-${stamp}${suffix}`)
      if (suffix === '') moved = true
    } catch {}
  }
  if (!moved) return null
  try {
    return open()
  } catch (error) {
    log('Database recreation failed', error)
    return null
  }
}
