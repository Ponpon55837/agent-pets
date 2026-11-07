import { resolveLoginItemExecutable } from './desktop-preferences.ts'

export const RELAUNCH_FLAG = '--relaunch'

export interface RelaunchOptions {
  execPath?: string
  args: string[]
}

/**
 * Chooses how to relaunch. The Windows portable target runs from a temporary
 * extraction directory that is deleted on exit, so the default
 * `process.execPath` would point at nothing; relaunch the original launcher
 * instead (validated as an absolute, existing, non-symlink .exe).
 */
export function resolveRelaunchOptions(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  argv: readonly string[],
  portableExecutableFile?: string,
  execPath = '',
): RelaunchOptions {
  if (platform === 'win32' && portableExecutableFile) {
    const launcher = resolveLoginItemExecutable(platform, isPackaged, execPath, portableExecutableFile)
    if (launcher) return { execPath: launcher, args: [RELAUNCH_FLAG] }
  }
  return { args: [...argv.slice(1).filter(arg => arg !== RELAUNCH_FLAG), RELAUNCH_FLAG] }
}

export interface RelaunchApp {
  isPackaged: boolean
  relaunch(options?: RelaunchOptions): void
}

export function relaunchApp(app: RelaunchApp): void {
  app.relaunch(resolveRelaunchOptions(
    process.platform,
    app.isPackaged,
    process.argv,
    process.env.PORTABLE_EXECUTABLE_FILE,
    process.execPath,
  ))
}

/**
 * Takes the single-instance lock, tolerating a relaunch racing the previous
 * process's exit: a relaunched instance retries for about 2s before giving up.
 */
export function acquireSingleInstanceLock(
  request: () => boolean,
  options: {
    argv: readonly string[]
    sleep: (ms: number) => void
    attempts?: number
    delayMs?: number
  },
): boolean {
  if (request()) return true
  if (!options.argv.includes(RELAUNCH_FLAG)) return false
  const attempts = options.attempts ?? 8
  const delayMs = options.delayMs ?? 250
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    options.sleep(delayMs)
    if (request()) return true
  }
  return false
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
