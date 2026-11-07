import * as fs from 'node:fs'
import * as path from 'node:path'
import { redactText, redactValue, type RedactOptions } from './redact.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MAX_LINE_CHARS = 2_000

export interface LoggerOptions {
  directory: string
  fileName?: string
  maxBytes?: number
  maxFiles?: number
  minLevel?: LogLevel
  flushIntervalMs?: number
  now?: () => number
  redact?: RedactOptions
}

export interface Logger {
  log(level: LogLevel, channel: string, message: string, detail?: unknown): void
  flush(): void
  /** Last `lines` log lines across rotated files, newest last. Already redacted when written. */
  readRecent(lines?: number): string[]
  close(): void
}

/**
 * Minimal rotating file logger. Lines are redacted before they are buffered
 * and are written only to the local userData directory; nothing is uploaded.
 */
export function createLogger(options: LoggerOptions): Logger {
  const fileName = options.fileName ?? 'main.log'
  const maxBytes = options.maxBytes ?? 1024 * 1024
  const maxFiles = options.maxFiles ?? 3
  const minRank = LEVEL_RANK[options.minLevel ?? 'info']
  const now = options.now ?? Date.now
  const filePath = path.join(options.directory, fileName)
  let buffer: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let size = -1
  let closed = false

  const rotate = () => {
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const from = index === 1 ? filePath : `${filePath}.${index - 1}`
      const to = `${filePath}.${index}`
      try { fs.renameSync(from, to) } catch {}
    }
    size = 0
  }

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (buffer.length === 0) return
    const chunk = buffer.join('')
    buffer = []
    try {
      fs.mkdirSync(options.directory, { recursive: true })
      if (size < 0) {
        try { size = fs.statSync(filePath).size } catch { size = 0 }
      }
      if (size + Buffer.byteLength(chunk) > maxBytes && size > 0) rotate()
      fs.appendFileSync(filePath, chunk, { mode: 0o600 })
      size += Buffer.byteLength(chunk)
    } catch {
      // Logging must never throw into the caller.
    }
  }

  return {
    log(level, channel, message, detail) {
      if (closed || LEVEL_RANK[level] < minRank) return
      let line = `${new Date(now()).toISOString()} ${level.toUpperCase()} [${channel}] ${redactText(message, options.redact)}`
      if (detail !== undefined) {
        const safe = redactValue(detail, options.redact)
        line += ` ${typeof safe === 'string' ? safe : JSON.stringify(safe)}`
      }
      line = `${line.replace(/\r?\n/g, '\\n').slice(0, MAX_LINE_CHARS)}\n`
      buffer.push(line)
      if (level === 'error' || buffer.length >= 50) flush()
      else if (!timer) {
        timer = setTimeout(flush, options.flushIntervalMs ?? 500)
        timer.unref?.()
      }
    },
    flush,
    readRecent(lines = 200) {
      flush()
      const collected: string[] = []
      for (let index = maxFiles - 1; index >= 0; index -= 1) {
        const file = index === 0 ? filePath : `${filePath}.${index}`
        try { collected.push(...fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) } catch {}
      }
      return collected.slice(-lines)
    },
    close() {
      flush()
      closed = true
    },
  }
}
