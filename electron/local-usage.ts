import { createHash } from 'node:crypto'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Dirent,
} from 'node:fs'
import { extname, join, relative } from 'node:path'
import type { HistoryStore } from './history.ts'
import type { HistoryTokenUsageRecord } from '../src/types/history.ts'

type UsageProvider = 'codex' | 'claude-code'

interface UsageRoot {
  provider: UsageProvider
  adapterId: 'codex' | 'claude-code'
  agentId: 'codex' | 'claude'
  directory: string
}

interface ParsedUsage extends HistoryTokenUsageRecord {
  dedupeKey: string
  cwd?: string
}

interface TokenCounters {
  input: number
  output: number
}

export interface ProjectPathResolver {
  // Must resolve AND register the project (not a read-only lookup): a
  // project whose only evidence is historical Claude/Codex log files, never
  // a live routed event, still needs a row in the project list so its token
  // totals are reachable from the History project filter instead of always
  // reading back as zero.
  trackSeen(value: unknown, seenAt?: number): { projectId: string } | null
}

export interface LocalUsageReaderOptions {
  homeDir: string
  history: HistoryStore
  now?: () => number
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  maxLineBytes?: number
  projectRouting?: ProjectPathResolver | null
}

export interface LocalUsageScanResult {
  filesScanned: number
  filesSkipped: number
  recordsParsed: number
  recordsImported: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_FILES = 2_000
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_LINE_BYTES = 256 * 1024
const MAX_WALK_DEPTH = 8
const MAX_TOKEN_COUNT = 1_000_000_000_000

function digest(value: string, length = 48): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : undefined
}

function token(value: unknown): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TOKEN_COUNT
    ? value
    : 0
}

function tokenSum(value: Record<string, unknown>, fields: string[]): number {
  return Math.min(MAX_TOKEN_COUNT, fields.reduce((sum, field) => sum + token(value[field]), 0))
}

function outputCount(value: Record<string, unknown>): number {
  const output = token(value.output_tokens)
  return output > 0 ? output : token(value.reasoning_output_tokens)
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Some JSONL producers use Unix seconds while others use milliseconds.
    return value < 100_000_000_000 ? value * 1_000 : value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function usageId(provider: UsageProvider, stableKey: string): string {
  return digest(`agent-pets:${provider}:${stableKey}`)
}

function claudeUsage(
  record: Record<string, unknown>,
  message: Record<string, unknown>,
  usage: Record<string, unknown>,
  fileKey: string,
  lineNumber: number,
  fallbackAt: number,
): ParsedUsage | null {
  const input = tokenSum(usage, ['input_tokens', 'cache_read_input_tokens'])
  const topLevelCacheCreation = token(usage.cache_creation_input_tokens)
  const cacheCreation = asObject(usage.cache_creation)
  const cacheCreationNested = cacheCreation
    ? tokenSum(cacheCreation, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'])
    : 0
  const output = outputCount(usage)
  const totalInput = Math.min(MAX_TOKEN_COUNT, input + (cacheCreationNested || topLevelCacheCreation))
  if (totalInput === 0 && output === 0) return null

  const sessionId = text(record.session_id) ?? text(record.sessionId) ?? fileKey
  const messageId = text(message.id)
  const requestId = text(record.request_id) ?? text(record.requestId) ?? text(message.request_id)
  const stableKey = messageId
    ? `message:${messageId}:${requestId ?? ''}`
    : `line:${fileKey}:${lineNumber}`
  const occurredAt = timestamp(record.timestamp ?? message.timestamp, fallbackAt)
  return {
    adapterId: 'claude-code',
    agentId: 'claude',
    sessionId,
    sourceEventId: usageId('claude-code', stableKey),
    occurredAt,
    input: totalInput,
    output,
    quality: 'exact',
    dedupeKey: stableKey,
    cwd: text(record.cwd),
  }
}

interface CodexUsageResult {
  // Null when this event carries no importable token delta (first sighting
  // of a baseline, a repeated snapshot, or a post-reset event - see below).
  record: ParsedUsage | null
  // The raw cumulative counter this event reported, always populated so the
  // caller can rebase its running baseline even when `record` is null.
  cumulative: TokenCounters
}

function codexUsage(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  info: Record<string, unknown>,
  usage: Record<string, unknown>,
  fileKey: string,
  lineNumber: number,
  fallbackAt: number,
  previousTotal: TokenCounters | null,
  fileCwd: string | undefined,
): CodexUsageResult | null {
  const totalUsage = asObject(info.total_token_usage)
  // Codex's total_token_usage is cumulative for the rollout. last_token_usage
  // is a context snapshot and may be repeated on rate-limit-only events, so it
  // is never treated as a fresh spend when the cumulative counter is present.
  if (!totalUsage) return null
  const currentTotal: TokenCounters = {
    input: token(totalUsage.input_tokens),
    output: outputCount(totalUsage),
  }
  // A drop below the previous cumulative total means context compaction or a
  // resumed/forked thread re-based the counter - not that Codex refunded
  // tokens. We cannot tell how much of the smaller new total was already
  // billed before the reset, so the safe choice is to count zero new tokens
  // for this event and simply rebase the baseline to the new total, rather
  // than (as before) treating the entire post-reset value as fresh spend,
  // which could spike the displayed total far past what Codex actually used.
  const input = previousTotal ? Math.max(0, currentTotal.input - previousTotal.input) : currentTotal.input
  const output = previousTotal ? Math.max(0, currentTotal.output - previousTotal.output) : currentTotal.output
  if (input === 0 && output === 0) return { record: null, cumulative: currentTotal }

  const sessionId = text(record.session_id)
    ?? text(record.sessionId)
    ?? text(payload.session_id)
    ?? text(payload.sessionId)
    ?? fileKey
  const stableKey = `line:${fileKey}:${lineNumber}`
  const occurredAt = timestamp(record.timestamp ?? payload.timestamp, fallbackAt)
  return {
    record: {
      adapterId: 'codex',
      agentId: 'codex',
      sessionId,
      sourceEventId: usageId('codex', stableKey),
      occurredAt,
      input,
      output,
      quality: 'exact',
      dedupeKey: stableKey,
      cwd: fileCwd,
    },
    cumulative: currentTotal,
  }
}

export function parseLocalUsageLine(
  provider: UsageProvider,
  line: string,
  fileKey: string,
  lineNumber: number,
  fallbackAt: number,
): ParsedUsage | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  const record = asObject(value)
  if (!record) return null

  if (provider === 'claude-code' && record.type === 'assistant') {
    const message = asObject(record.message)
    const usage = asObject(message?.usage)
    if (!message || !usage) return null
    return claudeUsage(record, message, usage, fileKey, lineNumber, fallbackAt)
  }

  return null
}

function filesUnder(root: string, maxFiles: number): string[] {
  const files: string[] = []
  let realRoot: string
  try {
    const rootStat = lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return files
    realRoot = realpathSync.native(root)
  } catch {
    return files
  }

  const isWithinRoot = (candidate: string): boolean => {
    const relativePath = relative(realRoot, candidate)
    return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
  }

  const visit = (directory: string, depth: number): void => {
    if (files.length >= maxFiles || depth > MAX_WALK_DEPTH) return
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return
      const candidate = join(directory, entry.name)
      let stat
      try { stat = lstatSync(candidate) } catch { continue }
      if (stat.isSymbolicLink()) continue
      let realCandidate: string
      try { realCandidate = realpathSync.native(candidate) } catch { continue }
      if (!isWithinRoot(realCandidate)) continue
      if (stat.isDirectory()) {
        visit(candidate, depth + 1)
      } else if (stat.isFile() && extname(entry.name).toLowerCase() === '.jsonl') {
        files.push(realCandidate)
      }
    }
  }

  visit(realRoot, 0)
  return files
}

function parseUsageFile(
  provider: UsageProvider,
  fileKey: string,
  content: string,
  fallbackAt: number,
  maxLineBytes: number,
): ParsedUsage[] {
  const records = new Map<string, ParsedUsage>()
  const lines = content.split(/\r?\n/)

  if (provider === 'codex') {
    let previousCodexTotal: TokenCounters | null = null
    // Codex only reports the workspace path once, on the file's leading
    // session_meta line; every later token_count event inherits it.
    let codexCwd: string | undefined
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line || Buffer.byteLength(line, 'utf8') > maxLineBytes) continue
      if (codexCwd === undefined) codexCwd = codexSessionCwd(line) ?? codexCwd
      const result = parseCodexUsageLine(line, fileKey, index + 1, fallbackAt, previousCodexTotal, codexCwd)
      if (!result) continue
      // Rebase the running baseline even when this event produced no
      // importable record (first sighting, repeat, or a reset) - otherwise a
      // reset would leave the old, now-stale total in place and every
      // following event would keep computing its delta against it.
      previousCodexTotal = result.cumulative
      if (result.record) records.set(result.record.dedupeKey, result.record)
    }
    return [...records.values()]
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || Buffer.byteLength(line, 'utf8') > maxLineBytes) continue
    const parsed = parseLocalUsageLine(provider, line, fileKey, index + 1, fallbackAt)
    if (!parsed) continue
    // Claude streaming records may repeat the same message id with cumulative
    // usage. Keep the latest record for that message and import it once.
    records.set(parsed.dedupeKey, parsed)
  }
  return [...records.values()]
}

function codexSessionCwd(line: string): string | undefined {
  let value: unknown
  try { value = JSON.parse(line) } catch { return undefined }
  const record = asObject(value)
  if (!record || record.type !== 'session_meta') return undefined
  const payload = asObject(record.payload)
  return payload ? text(payload.cwd) : undefined
}

function parseCodexUsageLine(
  line: string,
  fileKey: string,
  lineNumber: number,
  fallbackAt: number,
  previousTotal: TokenCounters | null,
  fileCwd: string | undefined,
): CodexUsageResult | null {
  let value: unknown
  try { value = JSON.parse(line) } catch { return null }
  const record = asObject(value)
  if (!record || record.type !== 'event_msg') return null
  const payload = asObject(record.payload)
  if (!payload || payload.type !== 'token_count') return null
  const info = asObject(payload.info)
  const usage = info ? asObject(info.last_token_usage) : null
  if (!info || !usage) return null
  return codexUsage(record, payload, info, usage, fileKey, lineNumber, fallbackAt, previousTotal, fileCwd)
}

export class LocalUsageReader {
  private readonly homeDir: string
  private readonly history: HistoryStore
  private readonly now: () => number
  private readonly maxFiles: number
  private readonly maxFileBytes: number
  private readonly maxTotalBytes: number
  private readonly maxLineBytes: number
  private readonly projectRouting: ProjectPathResolver | null
  private readonly fileCache = new Map<string, { mtimeMs: number; size: number }>()
  private activeScan: Promise<LocalUsageScanResult> | null = null

  constructor(options: LocalUsageReaderOptions) {
    this.homeDir = options.homeDir
    this.history = options.history
    this.now = options.now ?? Date.now
    this.maxFiles = Math.max(1, Math.min(DEFAULT_MAX_FILES, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES)))
    this.maxFileBytes = Math.max(64 * 1024, Math.min(DEFAULT_MAX_FILE_BYTES, Math.floor(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)))
    this.maxTotalBytes = Math.max(this.maxFileBytes, Math.min(DEFAULT_MAX_TOTAL_BYTES, Math.floor(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES)))
    this.maxLineBytes = Math.max(4 * 1024, Math.min(DEFAULT_MAX_LINE_BYTES, Math.floor(options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES)))
    this.projectRouting = options.projectRouting ?? null
  }

  scan(): Promise<LocalUsageScanResult> {
    if (this.activeScan) return this.activeScan
    this.activeScan = Promise.resolve().then(() => this.scanNow()).finally(() => {
      this.activeScan = null
    })
    return this.activeScan
  }

  private scanNow(): LocalUsageScanResult {
    const roots: UsageRoot[] = [
      { provider: 'codex', adapterId: 'codex', agentId: 'codex', directory: join(this.homeDir, '.codex', 'sessions') },
      { provider: 'claude-code', adapterId: 'claude-code', agentId: 'claude', directory: join(this.homeDir, '.claude', 'projects') },
      { provider: 'claude-code', adapterId: 'claude-code', agentId: 'claude', directory: join(this.homeDir, '.claude', 'transcripts') },
    ]
    const result: LocalUsageScanResult = { filesScanned: 0, filesSkipped: 0, recordsParsed: 0, recordsImported: 0 }
    const cutoff = Math.max(
      this.history.getLocalUsageCutoff(),
      this.now() - this.history.getRetentionDays() * DAY_MS,
    )
    let remainingFiles = this.maxFiles
    let remainingBytes = this.maxTotalBytes

    for (const root of roots) {
      if (remainingFiles <= 0) break
      const files = filesUnder(root.directory, remainingFiles)
      remainingFiles -= files.length
      for (const filePath of files) {
        let stat
        try { stat = lstatSync(filePath) } catch { result.filesSkipped += 1; continue }
        if (stat.size > this.maxFileBytes || stat.size > remainingBytes) {
          result.filesSkipped += 1
          continue
        }
        const cacheKey = `${root.provider}:${filePath}`
        const previous = this.fileCache.get(cacheKey)
        if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) continue
        let content: string
        try { content = readFileSync(filePath, 'utf8') } catch { result.filesSkipped += 1; continue }
        remainingBytes -= stat.size
        this.fileCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size })
        result.filesScanned += 1
        const fileKey = digest(`${root.provider}:${filePath}`)
        const records = parseUsageFile(root.provider, fileKey, content, stat.mtimeMs, this.maxLineBytes)
        result.recordsParsed += records.length
        for (const record of records) {
          if (record.occurredAt <= cutoff) continue
          // trackSeen (not a read-only resolve) so a project whose only
          // evidence is this log file still gets a row in the project list -
          // otherwise its token totals would be correctly computed but
          // permanently unreachable from the History project filter.
          const projectId = record.cwd
            ? this.projectRouting?.trackSeen(record.cwd, record.occurredAt)?.projectId
            : undefined
          if (this.history.recordTokenUsage({ ...record, projectId })) result.recordsImported += 1
        }
      }
    }
    return result
  }
}
