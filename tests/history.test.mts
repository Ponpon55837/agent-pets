import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { HistoryStore } from '../electron/history.ts'
import type { AgentStatusEvent } from '../src/types/agent.ts'

function databasePath(): { filePath: string; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-history-'))
  return { filePath: path.join(directory, 'history.sqlite'), directory }
}

function event(overrides: Partial<AgentStatusEvent> = {}): AgentStatusEvent {
  return {
    adapterId: 'codex',
    source: 'codex',
    sessionId: 'session-1',
    state: 'thinking',
    timestamp: Date.UTC(2026, 7, 13, 1, 0, 0),
    ...overrides,
  }
}

test('history writes idempotent events and serves seven-day aggregates', (t) => {
  const dayOne = Date.UTC(2026, 7, 10, 1, 0, 0)
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, {
    now: () => now,
    localDate: timestamp => timestamp < Date.UTC(2026, 7, 13) ? '2026-08-10' : '2026-08-13',
  })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordEvent(event({ timestamp: dayOne, eventId: 'start' })), true)
  assert.equal(store.recordEvent(event({ state: 'tool-running', timestamp: dayOne + 60_000, eventId: 'tool' })), true)
  assert.equal(store.recordEvent(event({
    state: 'success',
    timestamp: dayOne + 120_000,
    eventId: 'finish',
    tokenUsage: { input: 120, output: 40, quality: 'exact' },
  })), true)
  assert.equal(store.recordEvent(event({ state: 'success', timestamp: dayOne + 120_000, eventId: 'finish' })), false)

  const summary = store.getSummary()
  const oldDay = summary.days.find(day => day.localDate === '2026-08-10')!
  assert.equal(oldDay.sessionsCompleted, 1)
  assert.equal(oldDay.activeMs, 120_000)
  assert.equal(oldDay.tokenInput, 120)
  assert.equal(oldDay.tokenOutput, 40)
  assert.equal(oldDay.tokenQuality, 'exact')
  assert.equal(summary.totals.sessionsCompleted, 1)
  assert.equal(summary.agents[0].adapterId, 'codex')
  assert.equal(summary.agents[0].tokenInput, 120)
  assert.equal(summary.agents[0].tokenOutput, 40)
  assert.equal(summary.agents[0].tokenQuality, 'exact')
})

test('history distinguishes estimated and exact token quality and redacts event content', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordEvent(event({
    eventId: 'estimated',
    project: 'C:\\Users\\dgh\\private-project',
    tokenUsage: { input: 10, output: 5, quality: 'estimated' },
  })), true)
  const estimated = store.getSummary()
  assert.equal(estimated.tokenQuality, 'estimated')
  assert.equal(estimated.totals.tokenInput, 10)
  assert.equal(estimated.totals.tokenOutput, 5)

  assert.equal(store.recordEvent(event({
    eventId: 'exact',
    tokenUsage: { input: 20, output: 8, quality: 'exact' },
  })), true)
  const exact = store.getSummary()
  assert.equal(exact.tokenQuality, 'exact')
  assert.equal(exact.totals.tokenInput, 30)
  assert.equal(exact.totals.tokenOutput, 13)
  const exported = JSON.stringify(store.getExport())
  assert.equal(exported.includes('private-project'), false)
  assert.equal(exported.includes('tool argument'), false)
})

test('quota snapshots are bounded and history clear is independent from XP storage', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordQuotaSnapshot({
    updatedAt: new Date(now).toISOString(),
    providers: [{
      id: 'codex',
      name: 'Codex',
      plan: 'Plus',
      secret: 'must-not-persist',
      windows: [{ id: 'session', label: 'Session', remainingPercent: 87.5, resetsAt: new Date(now + 60_000).toISOString() }],
    }],
  }), true)
  assert.equal(store.getSummary().quota?.providers[0].windows[0].remainingPercent, 87.5)
  const quotaExport = JSON.stringify(store.getExport())
  assert.equal(quotaExport.includes('must-not-persist'), false)

  store.recordEvent(event({ eventId: 'clear-me', state: 'success' }))
  store.clear()
  const cleared = store.getSummary()
  assert.equal(cleared.totals.sessionsCompleted, 0)
  assert.equal(cleared.quota, null)
})

test('history filters by project and keeps identical session IDs isolated', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  const projectA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const projectB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  assert.equal(store.recordEvent(event({
    projectId: projectA,
    eventId: 'project-a-start',
    timestamp: now,
  }), 'wolf'), true)
  assert.equal(store.recordEvent(event({
    projectId: projectA,
    eventId: 'project-a-finish',
    state: 'success',
    timestamp: now + 60_000,
    tokenUsage: { input: 100, output: 20, quality: 'exact' },
  }), 'wolf'), true)
  assert.equal(store.recordEvent(event({
    projectId: projectB,
    eventId: 'project-b-finish',
    state: 'success',
    timestamp: now + 60_000,
    tokenUsage: { input: 7, output: 3, quality: 'estimated' },
  }), 'wolf'), true)

  const projectSummary = store.getSummary('wolf', projectA)
  assert.equal(projectSummary.projectId, projectA)
  assert.equal(projectSummary.totals.sessionsCompleted, 1)
  assert.equal(projectSummary.totals.tokenInput, 100)
  assert.equal(projectSummary.totals.tokenOutput, 20)
  assert.equal(projectSummary.agents.length, 1)

  const allSummary = store.getSummary('wolf')
  assert.equal(allSummary.totals.sessionsCompleted, 2)
  assert.equal(allSummary.totals.tokenInput, 107)
  assert.equal(allSummary.totals.tokenOutput, 23)
})

test('history counts each terminal session once across distinct completion events', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  assert.equal(store.recordEvent(event({ eventId: 'success-1', state: 'success', timestamp: now })), true)
  assert.equal(store.recordEvent(event({ eventId: 'success-2', state: 'success', timestamp: now + 1_000 })), true)
  assert.equal(store.getSummary().totals.sessionsCompleted, 1)
  assert.equal(store.getAchievementCompletedSessions().length, 1)

  assert.equal(store.recordEvent(event({
    sessionId: 'failed-session',
    eventId: 'error-1',
    state: 'error',
    timestamp: now + 2_000,
  })), true)
  assert.equal(store.recordEvent(event({
    sessionId: 'failed-session',
    eventId: 'success-after-error',
    state: 'success',
    timestamp: now + 3_000,
  })), true)
  const summary = store.getSummary()
  assert.equal(summary.totals.sessionsCompleted, 2)
  assert.equal(summary.totals.sessionsFailed, 0)
  assert.equal(store.getAchievementCompletedSessions().length, 2)

  assert.equal(store.recordEvent(event({
    adapterId: 'generic-http',
    eventId: 'same-session-other-adapter',
    state: 'success',
    timestamp: now + 4_000,
  })), true)
  assert.equal(store.getSummary().totals.sessionsCompleted, 2)
  assert.equal(store.getAchievementCompletedSessions().length, 2)
})

test('daily summary pet/date index preserves 1,000 seeded query results', (t) => {
  const now = Date.UTC(2026, 9, 26, 12)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, {
    now: () => now,
    localDate: timestamp => new Date(timestamp).toISOString().slice(0, 10),
  })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })

  const dates = Array.from({ length: 7 }, (_, index) => `2026-10-${String(20 + index).padStart(2, '0')}`)
  const pets = ['aang-airbender', 'local-usage', 'wolf']
  const adapters = ['claude-code', 'codex', 'generic-http']
  const insert = store.database.prepare(`
    INSERT INTO daily_stats(
      local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
      active_ms, token_input, token_output, token_quality
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  store.batch(() => {
    for (let index = 0; index < 1_000; index += 1) {
      const projectId = index.toString(16).padStart(32, '0')
      insert.run(
        dates[index % dates.length],
        pets[index % pets.length],
        projectId,
        adapters[index % adapters.length],
        index % 7,
        index % 5,
        index * 1_000,
        index * 10,
        index * 3,
        index % 2 === 0 ? 'exact' : 'estimated',
      )
    }
  })

  const querySql = `
    SELECT local_date, pet_id, project_id, adapter_id, sessions_completed, sessions_failed,
           active_ms, token_input, token_output, token_quality
    FROM daily_stats
    WHERE (pet_id = ? OR pet_id = ?) AND local_date IN (${dates.map(() => '?').join(', ')})
  `
  const runCases = () => {
    let seed = 0x18_03_2026
    const next = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed
    }
    return Array.from({ length: 1_000 }, () => {
      const petId = pets[next() % pets.length]!
      const rows = store.database.prepare(querySql).all(petId, 'local-usage', ...dates)
      return rows.map(row => [
        row.local_date, row.pet_id, row.project_id, row.adapter_id, row.sessions_completed,
        row.sessions_failed, row.active_ms, row.token_input, row.token_output, row.token_quality,
      ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    })
  }

  store.database.exec('DROP INDEX idx_daily_stats_pet_date')
  const withoutIndex = runCases()
  store.database.exec(`
    CREATE INDEX idx_daily_stats_pet_date ON daily_stats(pet_id, local_date)
  `)
  const withIndex = runCases()
  assert.deepEqual(withIndex, withoutIndex)
  const plan = store.database.prepare(`EXPLAIN QUERY PLAN ${querySql}`).all('aang-airbender', 'local-usage', ...dates)
  assert.ok(plan.some(row => String(row.detail).includes('idx_daily_stats_pet_date')))
})

test('history v4 migration repairs inflated completion aggregates from unique sessions', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const first = new HistoryStore(database.filePath, { now: () => now })
  assert.equal(first.recordEvent(event({
    eventId: 'finish',
    state: 'success',
    timestamp: now,
    tokenUsage: { input: 10, output: 5, quality: 'exact' },
  })), true)
  first.close()

  const moduleRequire = createRequire(import.meta.url)
  const { DatabaseSync } = moduleRequire('node:sqlite') as {
    DatabaseSync: new (filePath: string) => {
      exec(sql: string): void
      close(): void
    }
  }
  const raw = new DatabaseSync(database.filePath)
  raw.exec(`
    UPDATE daily_stats SET sessions_completed = 9;
    DELETE FROM schema_migrations WHERE version = 4;
  `)
  raw.close()

  const repaired = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { repaired.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.equal(repaired.getSummary().totals.sessionsCompleted, 1)
  assert.equal(repaired.getSummary().totals.tokenInput, 10)
  assert.equal(repaired.getSummary().totals.tokenOutput, 5)
})

test('history v6 migration adds cache columns and downgrades legacy exact local-log rows to estimated', (t) => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const first = new HistoryStore(database.filePath, { now: () => now, localDate: () => '2026-08-13' })
  assert.equal(first.recordTokenUsage({
    adapterId: 'claude-code', agentId: 'claude', sourceEventId: 'legacy-1', occurredAt: now,
    input: 900, output: 10, quality: 'exact',
  }), true)
  first.close()

  const moduleRequire = createRequire(import.meta.url)
  const { DatabaseSync } = moduleRequire('node:sqlite') as {
    DatabaseSync: new (filePath: string) => { exec(sql: string): void; close(): void }
  }
  // Rebuild a v5-shaped database: no cache columns, no v6 record.
  const raw = new DatabaseSync(database.filePath)
  raw.exec(`
    DROP INDEX IF EXISTS idx_daily_stats_summary_cover;
    ALTER TABLE events DROP COLUMN token_cache_read;
    ALTER TABLE events DROP COLUMN token_cache_write;
    ALTER TABLE daily_stats DROP COLUMN token_cache_read;
    ALTER TABLE daily_stats DROP COLUMN token_cache_write;
    DELETE FROM schema_migrations WHERE version = 6;
  `)
  raw.close()

  const migrated = new HistoryStore(database.filePath, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { migrated.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const summary = migrated.getSummary()
  assert.equal(summary.totals.tokenInput, 900)
  assert.equal(summary.totals.tokenCacheRead, 0)
  assert.equal(summary.tokenQuality, 'estimated')
  // A later scan with the cache split replaces the legacy row in place.
  assert.equal(migrated.recordTokenUsage({
    adapterId: 'claude-code', agentId: 'claude', sourceEventId: 'legacy-1', occurredAt: now,
    input: 40, output: 10, cacheRead: 860, quality: 'exact',
  }), true)
  const repaired = migrated.getSummary()
  assert.equal(repaired.totals.tokenInput, 40)
  assert.equal(repaired.totals.tokenCacheRead, 860)
  assert.equal(repaired.tokenQuality, 'exact')
})

test('quota snapshots clamp out-of-range remaining percentages instead of dropping the window', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => Date.UTC(2026, 7, 13, 1, 0, 0) })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.equal(store.recordQuotaSnapshot({
    updatedAt: '2026-08-13T01:00:00.000Z',
    providers: [{ id: 'claude', name: 'Claude', windows: [
      { id: 'session', label: 'Session', remainingPercent: -3 },
      { id: 'weekly', label: 'Weekly', remainingPercent: 105 },
      { id: 'ok', label: 'Ok', remainingPercent: 40 },
    ] }],
  }), true)
  const windows = store.getSummary().quota?.providers[0].windows ?? []
  assert.deepEqual(windows.map(w => [w.id, w.remainingPercent]), [['session', 0], ['weekly', 100], ['ok', 40]])
})

test('summary supports 30 and 90 day ranges with a previous-period comparison', (t) => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 7, 13, 12, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const add = (daysAgo: number, id: string) => store.recordEvent(event({
    state: 'success', sessionId: id, eventId: id, timestamp: now - daysAgo * day, tokenUsage: { input: 10, output: 5, quality: 'exact' },
  }))
  add(1, 'recent')
  add(10, 'previous-week-or-month')
  add(45, 'older')

  const week = store.getSummary('aang-airbender', undefined, 7)
  assert.equal(week.days.length, 7)
  assert.equal(week.rangeDays, 7)
  assert.equal(week.totals.sessionsCompleted, 1)
  assert.equal(week.previousTotals.sessionsCompleted, 1)

  const month = store.getSummary('aang-airbender', undefined, 30)
  assert.equal(month.days.length, 30)
  assert.equal(month.totals.sessionsCompleted, 2)
  assert.equal(month.previousTotals.sessionsCompleted, 1)
  assert.equal(month.agents[0].tokenInput, 20)

  const quarter = store.getSummary('aang-airbender', undefined, 90)
  assert.equal(quarter.days.length, 90)
  assert.equal(quarter.totals.sessionsCompleted, 3)
  // Unsupported ranges fall back to a week.
  assert.equal(store.getSummary('aang-airbender', undefined, 12).days.length, 7)
  // The range query is served by the covering index, not a table scan.
  const plan = (store as unknown as { database: { prepare(sql: string): { all(...p: unknown[]): Array<{ detail: string }> } } })
    .database.prepare('EXPLAIN QUERY PLAN SELECT local_date FROM daily_stats WHERE pet_id IN (?, ?) AND local_date BETWEEN ? AND ?')
    .all('a', 'b', '2026-01-01', '2026-02-01').map(row => row.detail).join(' ')
  assert.match(plan, /idx_daily_stats_pet_date|sqlite_autoindex_daily_stats/)
})

test('unchanged quota readings are not rewritten, changed ones are, and old snapshots expire', (t) => {
  let now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const snapshot = (updatedAt: number, remaining: number) => ({
    updatedAt: new Date(updatedAt).toISOString(),
    providers: [{ id: 'codex', name: 'Codex', windows: [{ id: 's', label: 'Session', remainingPercent: remaining }] }],
  })
  assert.equal(store.recordQuotaSnapshot(snapshot(now, 80)), true)
  assert.equal(store.recordQuotaSnapshot(snapshot(now + 120_000, 80)), false)
  assert.equal(store.recordQuotaSnapshot(snapshot(now + 240_000, 79)), true)
  now += 31 * 24 * 60 * 60 * 1000
  assert.equal(store.recordQuotaSnapshot(snapshot(now, 50)), true)
  const rows = (store as unknown as { database: { prepare(s: string): { all(): unknown[] } } }).database
    .prepare('SELECT snapshot_id FROM quota_snapshots').all()
  assert.equal(rows.length, 1)
})

test('achievement completed-session facts can be read incrementally', (t) => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 7, 13, 12, 0, 0)
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => now })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  store.recordEvent(event({ eventId: 'old', sessionId: 'old', state: 'success', timestamp: now - 5 * day }))
  store.recordEvent(event({ eventId: 'new', sessionId: 'new', state: 'success', timestamp: now - 1000 }))
  assert.equal(store.getAchievementReconciledAt(), 0)
  assert.equal(store.getAchievementCompletedSessions().length, 2)
  store.setAchievementReconciledAt(now - day)
  assert.equal(store.getAchievementReconciledAt(), now - day)
  assert.deepEqual(store.getAchievementCompletedSessions(store.getAchievementReconciledAt()).map(f => f.sessionId), ['new'])
})

test('history database runs WAL with synchronous=NORMAL and partial success indexes (v7)', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath)
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  assert.deepEqual(store.getPragmaState(), { journalMode: 'wal', synchronous: 1 })
  const raw = store.database as unknown as { prepare(sql: string): { all(...p: unknown[]): Array<Record<string, unknown>> } }
  const indexes = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('events', 'daily_stats')").all()
  const names = indexes.map(row => String(row.name))
  assert.ok(names.includes('idx_history_events_success_identity'))
  assert.ok(!names.includes('idx_history_events_completion_identity'))
  assert.ok(!names.includes('idx_daily_stats_summary_cover'))
  const success = indexes.find(row => row.name === 'idx_history_events_success_identity')
  assert.match(String(success?.sql), /WHERE state = 'success'/)
  const plan = raw.prepare(`EXPLAIN QUERY PLAN SELECT event_id FROM events
    WHERE agent_id = ? AND session_id = ? AND project_id = ? AND pet_id = ? AND state = 'success' LIMIT 1`)
    .all('a', 'b', '', 'p').map(row => row.detail).join(' ')
  assert.match(plan, /idx_history_events_success_identity/)
})

test('single-statement daily upsert accumulates, floors at zero and merges quality', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath)
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  const priv = store as unknown as { updateDailyStat(...a: unknown[]): void, database: { prepare(sql: string): { get(...p: unknown[]): Record<string, unknown> } } }
  priv.updateDailyStat('2026-01-01', 'p', '', 'codex', 'success', 1000, 10, 5, 'estimated', 2, 3)
  priv.updateDailyStat('2026-01-01', 'p', '', 'codex', 'error', 500, 1, 1, 'exact', 0, 0)
  priv.updateDailyStat('2026-01-01', 'p', '', 'codex', null, 0, -100, -1, 'none', -1, -50)
  const row = priv.database.prepare('SELECT * FROM daily_stats WHERE pet_id = ?').get('p')
  assert.equal(row.sessions_completed, 1)
  assert.equal(row.sessions_failed, 1)
  assert.equal(row.active_ms, 1500)
  assert.equal(row.token_input, 0)
  assert.equal(row.token_output, 5)
  assert.equal(row.token_cache_read, 1)
  assert.equal(row.token_cache_write, 0)
  assert.equal(row.token_quality, 'exact')
})

test('queueEvent micro-batches into one commit and isolates a failing event', (t) => {
  const database = databasePath()
  const store = new HistoryStore(database.filePath, { now: () => 2_000_000 })
  t.after(() => { store.close(); fs.rmSync(database.directory, { recursive: true, force: true }) })
  let recorded = 0
  const base = { source: 'codex', sessionId: 's1', project: 'p', projectId: 'a'.repeat(32) } as const
  const onRecorded = () => { recorded += 1 }
  for (let i = 0; i < 50; i += 1) {
    store.queueEvent({ ...base, state: 'tool-running', timestamp: 1_000_000 + i * 1000 } as never, 'aang-airbender', onRecorded)
  }
  store.queueEvent({ ...base, state: 'success', timestamp: 1_100_000, sessionId: '' } as never, 'aang-airbender')
  store.queueEvent({ ...base, state: 'success', timestamp: 1_100_000 } as never, 'aang-airbender', onRecorded)
  assert.equal(store.flushQueued(), 51)
  assert.equal(recorded, 1)
  const summary = store.getSummary('aang-airbender', undefined, 7)
  assert.equal(summary.totals.sessionsCompleted, 1)
  assert.ok(summary.totals.activeMs > 0)
})
