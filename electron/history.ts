import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { AgentStatusEvent, AgentState } from '../src/types/agent.ts'
import {
  HISTORY_TERMINAL_STATES,
  type HistoryAgentStat,
  type HistoryDailyStat,
  type HistoryExport,
  type HistoryQuotaSnapshot,
  type HistoryQuotaProvider,
  type HistoryQuotaWindow,
  type HistorySummary,
  type HistoryTokenUsageRecord,
  type HistoryTokenQuality,
} from '../src/types/history.ts'

type SqliteRow = Record<string, unknown>

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint }
  get(...params: unknown[]): SqliteRow | undefined
  all(...params: unknown[]): SqliteRow[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

type DatabaseSyncConstructor = new (filePath: string) => SqliteDatabase

export interface HistoryStoreOptions {
  now?: () => number
  localDate?: (timestamp: number) => string
  retentionDays?: number
}

const DEFAULT_PET_ID = 'aang-airbender'
const LOCAL_USAGE_PET_ID = 'local-usage'
const DEFAULT_RETENTION_DAYS = 90
const MAX_RETENTION_DAYS = 3650
const MAX_TEXT_LENGTH = 128
const MAX_SESSION_ID_LENGTH = 256
const MAX_TOKEN_COUNT = 1_000_000_000_000
const MAX_QUOTA_SNAPSHOTS = 100
const MAX_QUOTA_PROVIDERS = 8
const MAX_QUOTA_WINDOWS = 32
const MAX_ACTIVE_GAP_MS = 5 * 60 * 1000
const LOCAL_USAGE_CUTOFF_KEY = 'local_usage_cutoff_at'
const ACTIVE_STATES = new Set<AgentState>(['thinking', 'tool-running'])
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/

function databaseConstructor(): DatabaseSyncConstructor {
  const moduleRequire = createRequire(import.meta.url)
  const loaded = moduleRequire('node:sqlite') as { DatabaseSync?: DatabaseSyncConstructor }
  if (!loaded.DatabaseSync) throw new Error('SQLite is unavailable in this runtime')
  return loaded.DatabaseSync
}

function asInteger(value: unknown, fallback = 0): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isSafeInteger(number) ? number : fallback
}

function safeCount(value: unknown): number | null {
  const number = asInteger(value, -1)
  return number >= 0 && number <= MAX_TOKEN_COUNT ? number : null
}

function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT_LENGTH) : fallback
}

function safePetId(value: string | undefined): string {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : DEFAULT_PET_ID
}

function digest(value: string, length = 24): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOffset(key: string, offset: number): string {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + offset)
  return localDateKey(date.getTime())
}

function changedCount(result: { changes: number | bigint }): number {
  return asInteger(result.changes)
}

function isActiveState(value: unknown): value is AgentState {
  return typeof value === 'string' && ACTIVE_STATES.has(value as AgentState)
}

function isTokenQuality(value: unknown): value is HistoryTokenQuality {
  return value === 'none' || value === 'estimated' || value === 'exact'
}

function mergeTokenQuality(left: HistoryTokenQuality, right: HistoryTokenQuality): HistoryTokenQuality {
  if (left === 'exact' || right === 'exact') return 'exact'
  if (left === 'estimated' || right === 'estimated') return 'estimated'
  return 'none'
}

function eventType(state: AgentState): string {
  if (state === 'success') return 'agent.session.completed'
  if (state === 'error') return 'agent.session.failed'
  if (state === 'offline') return 'agent.session.cancelled'
  if (state === 'waiting-input') return 'agent.waiting_input'
  if (state === 'waiting-permission') return 'agent.permission.requested'
  if (state === 'tool-running') return 'agent.tool.started'
  if (state === 'thinking') return 'agent.working'
  return 'agent.session.started'
}

function tokenUsage(event: AgentStatusEvent): {
  input: number | null
  output: number | null
  quality: HistoryTokenQuality
} {
  const usage = event.tokenUsage
  if (!usage || (usage.quality !== 'estimated' && usage.quality !== 'exact')) {
    return { input: null, output: null, quality: 'none' }
  }
  return {
    input: safeCount(usage.input),
    output: safeCount(usage.output),
    quality: usage.quality,
  }
}

interface SessionRow {
  sessionPk: string
  adapterId: string
  agentId: string
  externalSessionId: string
  projectId: string
  petId: string
  startedAt: number
  endedAt: number | null
  terminalState: AgentState | null
  activeMs: number
  tokenInput: number
  tokenOutput: number
  tokenQuality: HistoryTokenQuality
  lastState: AgentState
  lastSeenAt: number
}

function readSession(row: SqliteRow | undefined): SessionRow | null {
  if (!row || typeof row.session_pk !== 'string' || typeof row.adapter_id !== 'string') return null
  const state = typeof row.last_state === 'string' ? row.last_state as AgentState : 'idle'
  return {
    sessionPk: row.session_pk,
    adapterId: row.adapter_id,
    agentId: safeText(row.agent_id),
    externalSessionId: safeText(row.external_session_id),
    projectId: safeText(row.project_id),
    petId: safePetId(typeof row.pet_id === 'string' ? row.pet_id : undefined),
    startedAt: asInteger(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : asInteger(row.ended_at),
    terminalState: HISTORY_TERMINAL_STATES.has(row.terminal_state as AgentState)
      ? row.terminal_state as AgentState
      : null,
    activeMs: Math.max(0, asInteger(row.active_ms)),
    tokenInput: Math.max(0, asInteger(row.token_input)),
    tokenOutput: Math.max(0, asInteger(row.token_output)),
    tokenQuality: isTokenQuality(row.token_quality) ? row.token_quality : 'none',
    lastState: isActiveState(state) || HISTORY_TERMINAL_STATES.has(state) || state === 'idle'
      ? state
      : 'idle',
    lastSeenAt: Math.max(0, asInteger(row.last_seen_at)),
  }
}

export class HistoryStore {
  private readonly database: SqliteDatabase
  private readonly now: () => number
  private readonly localDate: (timestamp: number) => string
  private readonly retentionDays: number
  private closed = false

  constructor(filePath: string, options: HistoryStoreOptions = {}) {
    mkdirSync(dirname(filePath), { recursive: true })
    const DatabaseSync = databaseConstructor()
    this.database = new DatabaseSync(filePath)
    this.now = options.now ?? Date.now
    this.localDate = options.localDate ?? localDateKey
    this.retentionDays = Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.floor(options.retentionDays ?? DEFAULT_RETENTION_DAYS)))
    try {
      this.migrate()
      this.pruneEvents()
      const count = asInteger(this.database.prepare('SELECT COUNT(*) AS count FROM daily_stats').get()?.count)
      if (count === 0) this.rebuildDailyStats()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  getRetentionDays(): number {
    return this.retentionDays
  }

  getLocalUsageCutoff(): number {
    const value = this.database.prepare(
      'SELECT value FROM history_metadata WHERE key = ?',
    ).get(LOCAL_USAGE_CUTOFF_KEY)?.value
    const cutoff = Number(value)
    return Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : 0
  }

  recordEvent(event: AgentStatusEvent, petId = DEFAULT_PET_ID, receivedAt = this.now()): boolean {
    if (event.originalEvent === 'AgentPetsIntegrationTest') return false
    const safePet = safePetId(petId)
    const adapterId = SAFE_ID.test(event.adapterId ?? '') ? event.adapterId! : 'generic-http'
    const agentId = safeText(event.source, 'unknown')
    const externalId = safeText(event.sessionId).slice(0, MAX_SESSION_ID_LENGTH)
    if (!externalId) return false
    const sessionIdHash = digest(`${adapterId}:${agentId}:${externalId}`)
    const projectId = event.project ? digest(event.project) : ''
    const occurredAt = Number.isFinite(event.timestamp) ? Math.min(event.timestamp, receivedAt) : receivedAt
    const safeReceivedAt = Number.isFinite(receivedAt) ? receivedAt : this.now()
    const state = event.state
    const usage = tokenUsage(event)
    const eventId = SAFE_ID.test(event.eventId ?? '')
      ? event.eventId!
      : digest(`${adapterId}:${agentId}:${externalId}:${state}:${occurredAt}:${projectId}:${event.originalEvent ?? ''}`)
    const sourceEventId = typeof event.sourceEventId === 'string' ? safeText(event.sourceEventId) : null
    const localDate = this.localDate(occurredAt)
    const sessionPk = `${adapterId}:${agentId}:${sessionIdHash}`
    const completionKind = state === 'success' || state === 'error' ? state : null

    return this.transaction(() => {
      const previous = readSession(this.database.prepare(`
        SELECT session_pk, adapter_id, agent_id, external_session_id, project_id, pet_id,
               started_at, ended_at, terminal_state, active_ms, token_input, token_output,
               token_quality, last_state, last_seen_at
        FROM sessions WHERE session_pk = ?
      `).get(sessionPk))
      const activeDeltaMs = previous && isActiveState(previous.lastState) && occurredAt > previous.lastSeenAt
        ? Math.min(occurredAt - previous.lastSeenAt, MAX_ACTIVE_GAP_MS)
        : 0
      const inserted = changedCount(this.database.prepare(`
        INSERT OR IGNORE INTO events(
          event_id, source_event_id, schema_version, type, trust, adapter_id, agent_id,
          session_id, project_id, pet_id, local_date, occurred_at, received_at, state,
          active_delta_ms, completion_kind, token_input, token_output, token_quality, payload_json
        ) VALUES (?, ?, 2, ?, 'adapter_verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        sourceEventId,
        eventType(state),
        adapterId,
        agentId,
        externalId,
        projectId,
        safePet,
        localDate,
        occurredAt,
        safeReceivedAt,
        state,
        activeDeltaMs,
        completionKind,
        usage.input,
        usage.output,
        usage.quality,
        JSON.stringify({ state }),
      ))
      if (inserted === 0) return false

      const nextActiveMs = (previous?.activeMs ?? 0) + activeDeltaMs
      const nextInput = (previous?.tokenInput ?? 0) + (usage.input ?? 0)
      const nextOutput = (previous?.tokenOutput ?? 0) + (usage.output ?? 0)
      const nextQuality = mergeTokenQuality(previous?.tokenQuality ?? 'none', usage.quality)
      if (!previous) {
        this.database.prepare(`
          INSERT INTO sessions(
            session_pk, adapter_id, agent_id, external_session_id, project_id, pet_id,
            started_at, ended_at, terminal_state, active_ms, token_input, token_output,
            token_quality, last_state, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionPk,
          adapterId,
          agentId,
          sessionIdHash,
          projectId,
          safePet,
          occurredAt,
          completionKind ? occurredAt : null,
          completionKind,
          nextActiveMs,
          nextInput,
          nextOutput,
          nextQuality,
          state,
          occurredAt,
        )
      } else {
        this.database.prepare(`
          UPDATE sessions
          SET ended_at = CASE WHEN ? IS NOT NULL THEN ? ELSE ended_at END,
              terminal_state = CASE WHEN ? IS NOT NULL THEN ? ELSE terminal_state END,
              active_ms = ?, token_input = ?, token_output = ?, token_quality = ?,
              last_state = ?, last_seen_at = MAX(last_seen_at, ?)
          WHERE session_pk = ?
        `).run(
          completionKind,
          occurredAt,
          completionKind,
          completionKind,
          nextActiveMs,
          nextInput,
          nextOutput,
          nextQuality,
          state,
          occurredAt,
          sessionPk,
        )
      }

      this.updateDailyStat(
        localDate,
        safePet,
        projectId,
        adapterId,
        completionKind,
        activeDeltaMs,
        usage.input ?? 0,
        usage.output ?? 0,
        usage.quality,
      )
      return true
    })
  }

  recordTokenUsage(record: HistoryTokenUsageRecord, petId = DEFAULT_PET_ID, receivedAt = this.now()): boolean {
    // Local logs describe the machine/account, not the currently selected pet.
    // Keep them in a global bucket so switching pets cannot make token totals
    // appear to drop to zero. The parameter remains for API compatibility.
    void petId
    const safePet = LOCAL_USAGE_PET_ID
    const adapterId = SAFE_ID.test(record.adapterId) ? record.adapterId : ''
    const agentId = safeText(record.agentId, 'unknown')
    const sourceEventId = safeText(record.sourceEventId)
    if (!adapterId || !agentId || !sourceEventId) return false
    const input = safeCount(record.input) ?? 0
    const output = safeCount(record.output) ?? 0
    if (input === 0 && output === 0) return false
    if (record.quality !== 'exact' && record.quality !== 'estimated') return false
    const safeReceivedAt = Number.isFinite(receivedAt) ? receivedAt : this.now()
    const occurredAt = Number.isFinite(record.occurredAt)
      ? Math.min(record.occurredAt, safeReceivedAt)
      : safeReceivedAt
    const localDate = this.localDate(occurredAt)
    const projectId = ''
    const sessionId = typeof record.sessionId === 'string' && record.sessionId.length > 0
      ? digest(`${adapterId}:${agentId}:${record.sessionId}`)
      : null
    const eventId = digest(`local-usage:${adapterId}:${sourceEventId}`)

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT event_id, local_date, token_input, token_output, token_quality, occurred_at
        FROM events WHERE adapter_id = ? AND source_event_id = ?
      `).get(adapterId, sourceEventId)
      if (existing) {
        const previousInput = Math.max(0, asInteger(existing.token_input))
        const previousOutput = Math.max(0, asInteger(existing.token_output))
        const previousDate = safeText(existing.local_date)
        const previousOccurredAt = asInteger(existing.occurred_at)
        const previousQuality = isTokenQuality(existing.token_quality)
          ? existing.token_quality
          : 'none'
        if (
          previousInput === input
          && previousOutput === output
          && previousDate === localDate
          && previousOccurredAt === occurredAt
          && previousQuality === record.quality
        ) return false

        this.database.prepare(`
          UPDATE events
          SET session_id = ?, local_date = ?, occurred_at = ?, received_at = ?,
              token_input = ?, token_output = ?, token_quality = ?
          WHERE event_id = ?
        `).run(
          sessionId,
          localDate,
          occurredAt,
          safeReceivedAt,
          input,
          output,
          record.quality,
          existing.event_id,
        )
        this.updateDailyStat(
          previousDate,
          safePet,
          projectId,
          adapterId,
          null,
          0,
          -previousInput,
          -previousOutput,
          'none',
        )
        this.updateDailyStat(
          localDate,
          safePet,
          projectId,
          adapterId,
          null,
          0,
          input,
          output,
          record.quality,
        )
        return true
      }

      const inserted = changedCount(this.database.prepare(`
        INSERT OR IGNORE INTO events(
          event_id, source_event_id, schema_version, type, trust, adapter_id, agent_id,
          session_id, project_id, pet_id, local_date, occurred_at, received_at, state,
          active_delta_ms, completion_kind, token_input, token_output, token_quality, payload_json
        ) VALUES (?, ?, 2, 'agent.token_usage', 'local_log', ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 0, NULL, ?, ?, ?, '{}')
      `).run(
        eventId,
        sourceEventId,
        adapterId,
        agentId,
        sessionId,
        projectId,
        safePet,
        localDate,
        occurredAt,
        safeReceivedAt,
        input,
        output,
        record.quality,
      ))
      if (inserted === 0) return false
      this.updateDailyStat(
        localDate,
        safePet,
        projectId,
        adapterId,
        null,
        0,
        input,
        output,
        record.quality,
      )
      return true
    })
  }

  recordQuotaSnapshot(value: unknown): boolean {
    const snapshot = normalizeQuotaSnapshot(value)
    if (!snapshot) return false
    const snapshotId = digest(`${snapshot.updatedAt}:${JSON.stringify(snapshot.providers)}`)
    this.database.prepare(`
      INSERT OR REPLACE INTO quota_snapshots(snapshot_id, updated_at, payload_json)
      VALUES (?, ?, ?)
    `).run(snapshotId, snapshot.updatedAt, JSON.stringify(snapshot))
    this.database.prepare(`
      DELETE FROM quota_snapshots
      WHERE snapshot_id NOT IN (
        SELECT snapshot_id FROM quota_snapshots ORDER BY updated_at DESC LIMIT ?
      )
    `).run(MAX_QUOTA_SNAPSHOTS)
    return true
  }

  getSummary(petId = DEFAULT_PET_ID): HistorySummary {
    const safePet = safePetId(petId)
    const today = this.localDate(this.now())
    const dates = Array.from({ length: 7 }, (_, index) => dateOffset(today, index - 6))
    const placeholders = dates.map(() => '?').join(', ')
    const rows = this.database.prepare(`
      SELECT local_date, sessions_completed, sessions_failed, active_ms,
             token_input, token_output, token_quality
      FROM daily_stats
      WHERE (pet_id = ? OR pet_id = ?) AND local_date IN (${placeholders})
    `).all(safePet, LOCAL_USAGE_PET_ID, ...dates)
    // A day can have multiple aggregate rows (one per project and adapter).
    // Fold them before building the seven-day projection; keeping only the
    // last row would silently drop sessions and token usage from the HUD.
    const byDate = new Map<string, HistoryDailyStat>()
    for (const row of rows) {
      const date = String(row.local_date)
      const current = byDate.get(date) ?? emptyDaily(date)
      byDate.set(date, addDaily(current, dailyStat(date, row)))
    }
    const days = dates.map(localDate => {
      return byDate.get(localDate) ?? emptyDaily(localDate)
    })
    const totals = days.reduce((sum, day) => addDaily(sum, day), emptyDaily('total'))
    const agents = this.database.prepare(`
      SELECT adapter_id,
             SUM(sessions_completed) AS sessions_completed,
             SUM(sessions_failed) AS sessions_failed,
             SUM(active_ms) AS active_ms,
             SUM(token_input) AS token_input,
             SUM(token_output) AS token_output,
             MAX(CASE token_quality WHEN 'exact' THEN 2 WHEN 'estimated' THEN 1 ELSE 0 END) AS token_quality_rank
      FROM daily_stats
      WHERE (pet_id = ? OR pet_id = ?) AND local_date IN (${placeholders})
      GROUP BY adapter_id
      ORDER BY (token_input + token_output) DESC, active_ms DESC, adapter_id ASC
    `).all(safePet, LOCAL_USAGE_PET_ID, ...dates).map(row => ({
      adapterId: safeText(row.adapter_id, 'unknown'),
      sessionsCompleted: Math.max(0, asInteger(row.sessions_completed)),
      sessionsFailed: Math.max(0, asInteger(row.sessions_failed)),
      activeMs: Math.max(0, asInteger(row.active_ms)),
      tokenInput: Math.max(0, asInteger(row.token_input)),
      tokenOutput: Math.max(0, asInteger(row.token_output)),
      tokenQuality: asInteger(row.token_quality_rank) >= 2
        ? 'exact'
        : asInteger(row.token_quality_rank) >= 1 ? 'estimated' : 'none',
    } satisfies HistoryAgentStat))
    const quotaRow = this.database.prepare(
      'SELECT payload_json FROM quota_snapshots ORDER BY updated_at DESC LIMIT 1',
    ).get()
    const quota = parseQuotaSnapshot(quotaRow?.payload_json)
    return {
      schemaVersion: 1,
      generatedAt: this.now(),
      petId: safePet,
      retentionDays: this.retentionDays,
      days,
      totals,
      agents,
      tokenQuality: totals.tokenQuality,
      // Mirrors the cutoff LocalUsageReader.scanNow() actually applies, so
      // this always describes the window the numbers above really cover.
      tokenTrackingSince: Math.max(
        this.getLocalUsageCutoff(),
        this.now() - this.retentionDays * 24 * 60 * 60 * 1000,
      ),
      quota,
    }
  }

  getExport(petId = DEFAULT_PET_ID): HistoryExport {
    return {
      schemaVersion: 1,
      exportedAt: this.now(),
      summary: this.getSummary(petId),
    }
  }

  clear(): void {
    this.transaction(() => {
      this.database.exec('DELETE FROM events; DELETE FROM sessions; DELETE FROM daily_stats; DELETE FROM quota_snapshots;')
      this.database.prepare(`
        INSERT INTO history_metadata(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(LOCAL_USAGE_CUTOFF_KEY, String(this.now()))
    })
  }

  prune(): number {
    return this.pruneEvents()
  }

  rebuildDailyStats(): void {
    this.transaction(() => {
      this.database.exec('DELETE FROM daily_stats')
      const rows = this.database.prepare(`
        SELECT local_date, pet_id, project_id, adapter_id, completion_kind,
               active_delta_ms, token_input, token_output, token_quality
        FROM events ORDER BY occurred_at ASC, event_id ASC
      `).all()
      for (const row of rows) {
        this.updateDailyStat(
          safeText(row.local_date),
          safePetId(typeof row.pet_id === 'string' ? row.pet_id : undefined),
          safeText(row.project_id),
          safeText(row.adapter_id, 'unknown'),
          row.completion_kind === 'success' || row.completion_kind === 'error' ? row.completion_kind : null,
          Math.max(0, asInteger(row.active_delta_ms)),
          Math.max(0, asInteger(row.token_input)),
          Math.max(0, asInteger(row.token_output)),
          isTokenQuality(row.token_quality) ? row.token_quality : 'none',
        )
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private pruneEvents(): number {
    const cutoff = this.now() - this.retentionDays * 24 * 60 * 60 * 1000
    return changedCount(this.database.prepare('DELETE FROM events WHERE occurred_at < ?').run(cutoff))
  }

  private updateDailyStat(
    localDate: string,
    petId: string,
    projectId: string,
    adapterId: string,
    completionKind: 'success' | 'error' | null,
    activeMs: number,
    tokenInput: number,
    tokenOutput: number,
    tokenQuality: HistoryTokenQuality,
  ): void {
    const existing = this.database.prepare(`
      SELECT sessions_completed, sessions_failed, active_ms, token_input, token_output, token_quality
      FROM daily_stats WHERE local_date = ? AND pet_id = ? AND project_id = ? AND adapter_id = ?
    `).get(localDate, petId, projectId, adapterId)
    const currentQuality = isTokenQuality(existing?.token_quality) ? existing!.token_quality as HistoryTokenQuality : 'none'
    this.database.prepare(`
      INSERT INTO daily_stats(
        local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
        active_ms, token_input, token_output, token_quality
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_date, pet_id, project_id, adapter_id) DO UPDATE SET
        sessions_completed = excluded.sessions_completed,
        sessions_failed = excluded.sessions_failed,
        active_ms = excluded.active_ms,
        token_input = excluded.token_input,
        token_output = excluded.token_output,
        token_quality = excluded.token_quality
    `).run(
      localDate,
      petId,
      projectId,
      adapterId,
      Math.max(0, asInteger(existing?.sessions_completed) + (completionKind === 'success' ? 1 : 0)),
      Math.max(0, asInteger(existing?.sessions_failed) + (completionKind === 'error' ? 1 : 0)),
      Math.max(0, asInteger(existing?.active_ms) + activeMs),
      Math.max(0, asInteger(existing?.token_input) + tokenInput),
      Math.max(0, asInteger(existing?.token_output) + tokenOutput),
      mergeTokenQuality(currentQuality, tokenQuality),
    )
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
    `)
    const hasV1 = Boolean(this.database.prepare('SELECT version FROM schema_migrations WHERE version = 1').get())
    if (!hasV1) this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS events (
          event_id TEXT PRIMARY KEY,
          source_event_id TEXT,
          schema_version INTEGER NOT NULL,
          type TEXT NOT NULL,
          trust TEXT NOT NULL,
          adapter_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          session_id TEXT,
          project_id TEXT NOT NULL DEFAULT '',
          pet_id TEXT NOT NULL,
          local_date TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          received_at INTEGER NOT NULL,
          state TEXT NOT NULL,
          active_delta_ms INTEGER NOT NULL DEFAULT 0,
          completion_kind TEXT,
          token_input INTEGER,
          token_output INTEGER,
          token_quality TEXT NOT NULL DEFAULT 'none',
          payload_json TEXT NOT NULL,
          UNIQUE(adapter_id, source_event_id)
        );
        CREATE INDEX IF NOT EXISTS idx_history_events_occurred ON events(occurred_at);
        CREATE TABLE IF NOT EXISTS sessions (
          session_pk TEXT PRIMARY KEY,
          adapter_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          external_session_id TEXT NOT NULL,
          project_id TEXT NOT NULL DEFAULT '',
          pet_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          terminal_state TEXT,
          active_ms INTEGER NOT NULL DEFAULT 0,
          token_input INTEGER NOT NULL DEFAULT 0,
          token_output INTEGER NOT NULL DEFAULT 0,
          token_quality TEXT NOT NULL DEFAULT 'none',
          last_state TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          UNIQUE(adapter_id, external_session_id)
        );
        CREATE TABLE IF NOT EXISTS daily_stats (
          local_date TEXT NOT NULL,
          pet_id TEXT NOT NULL,
          project_id TEXT NOT NULL DEFAULT '',
          adapter_id TEXT NOT NULL,
          sessions_completed INTEGER NOT NULL DEFAULT 0,
          sessions_failed INTEGER NOT NULL DEFAULT 0,
          active_ms INTEGER NOT NULL DEFAULT 0,
          token_input INTEGER NOT NULL DEFAULT 0,
          token_output INTEGER NOT NULL DEFAULT 0,
          token_quality TEXT NOT NULL DEFAULT 'none',
          PRIMARY KEY(local_date, pet_id, project_id, adapter_id)
        );
        CREATE TABLE IF NOT EXISTS quota_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `)
      this.database.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (1, 'history-v1', ?, 'history-v1')
      `).run(this.now())
    })
    const hasV2 = Boolean(this.database.prepare('SELECT version FROM schema_migrations WHERE version = 2').get())
    if (!hasV2) this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS history_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
      this.database.prepare(`
        INSERT INTO history_metadata(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO NOTHING
      `).run(LOCAL_USAGE_CUTOFF_KEY, '0')
      this.database.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (2, 'history-local-usage-cutoff', ?, 'history-local-usage-cutoff')
      `).run(this.now())
    })
    const hasV3 = Boolean(this.database.prepare('SELECT version FROM schema_migrations WHERE version = 3').get())
    if (!hasV3) this.transaction(() => {
      // v2 stored local log rows under the selected/default pet. Move only
      // local-usage events and rebuild aggregates so existing totals remain
      // visible after users switch pets.
      this.database.exec(`
        UPDATE events SET pet_id = '${LOCAL_USAGE_PET_ID}' WHERE type = 'agent.token_usage';
        DELETE FROM daily_stats;
      `)
      this.database.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at, checksum)
        VALUES (3, 'history-global-local-usage', ?, 'history-global-local-usage')
      `).run(this.now())
    })
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    }
  }
}

function emptyDaily(localDate: string): HistoryDailyStat {
  return {
    localDate,
    sessionsCompleted: 0,
    sessionsFailed: 0,
    activeMs: 0,
    tokenInput: 0,
    tokenOutput: 0,
    tokenQuality: 'none',
  }
}

function dailyStat(localDate: string, row?: SqliteRow): HistoryDailyStat {
  return {
    localDate,
    sessionsCompleted: Math.max(0, asInteger(row?.sessions_completed)),
    sessionsFailed: Math.max(0, asInteger(row?.sessions_failed)),
    activeMs: Math.max(0, asInteger(row?.active_ms)),
    tokenInput: Math.max(0, asInteger(row?.token_input)),
    tokenOutput: Math.max(0, asInteger(row?.token_output)),
    tokenQuality: isTokenQuality(row?.token_quality) ? row!.token_quality as HistoryTokenQuality : 'none',
  }
}

function addDaily(left: HistoryDailyStat, right: HistoryDailyStat): HistoryDailyStat {
  return {
    localDate: left.localDate,
    sessionsCompleted: left.sessionsCompleted + right.sessionsCompleted,
    sessionsFailed: left.sessionsFailed + right.sessionsFailed,
    activeMs: left.activeMs + right.activeMs,
    tokenInput: left.tokenInput + right.tokenInput,
    tokenOutput: left.tokenOutput + right.tokenOutput,
    tokenQuality: mergeTokenQuality(left.tokenQuality, right.tokenQuality),
  }
}

function normalizeQuotaSnapshot(value: unknown): HistoryQuotaSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) return null
  if (!Array.isArray(raw.providers)) return null
  const providers: HistoryQuotaProvider[] = []
  for (const item of raw.providers.slice(0, MAX_QUOTA_PROVIDERS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const provider = item as Record<string, unknown>
    const id = safeText(provider.id)
    const name = safeText(provider.name)
    if (!id || !name || !Array.isArray(provider.windows)) continue
    const windows: HistoryQuotaWindow[] = []
    for (const entry of provider.windows.slice(0, MAX_QUOTA_WINDOWS)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const window = entry as Record<string, unknown>
      const windowId = safeText(window.id)
      const label = safeText(window.label)
      const remaining = Number(window.remainingPercent)
      if (!windowId || !label || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) continue
      const resetsAt = typeof window.resetsAt === 'string' && Number.isFinite(Date.parse(window.resetsAt))
        ? new Date(window.resetsAt).toISOString()
        : undefined
      windows.push({ id: windowId, label, remainingPercent: remaining, ...(resetsAt ? { resetsAt } : {}) })
    }
    providers.push({
      id,
      name,
      ...(typeof provider.plan === 'string' && provider.plan.trim() ? { plan: safeText(provider.plan) } : {}),
      windows,
    })
  }
  return { updatedAt: new Date(raw.updatedAt).toISOString(), providers }
}

function parseQuotaSnapshot(value: unknown): HistoryQuotaSnapshot | null {
  if (typeof value !== 'string') return null
  try { return normalizeQuotaSnapshot(JSON.parse(value)) } catch { return null }
}
