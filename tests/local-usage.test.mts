import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HistoryStore } from '../electron/history.ts'
import { LocalUsageReader } from '../electron/local-usage.ts'

function setup(): { home: string; database: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-local-usage-'))
  return {
    home: path.join(root, 'home'),
    database: path.join(root, 'history.sqlite'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
}

test('imports exact Codex and Claude local log usage and deduplicates Claude streaming chunks', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, {
    now: () => now,
    localDate: () => '2026-08-13',
  })
  t.after(() => { store.close(); fixture.cleanup() })

  const codexUsageRecord = (input: number, output: number) => ({
    type: 'event_msg',
    timestamp: new Date(now).toISOString(),
    session_id: 'codex-session',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: input, output_tokens: output },
        total_token_usage: { input_tokens: input, output_tokens: output },
      },
    },
  })
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', 'session.jsonl'), [
    codexUsageRecord(100, 20),
    codexUsageRecord(100, 20), // rate-limit-only repeat; must not be counted again
    codexUsageRecord(150, 35),
  ])
  writeJsonl(path.join(fixture.home, '.claude', 'projects', 'project', 'session.jsonl'), [
    {
      type: 'assistant',
      timestamp: new Date(now).toISOString(),
      session_id: 'claude-session',
      message: {
        id: 'message-1',
        usage: { input_tokens: 50, output_tokens: 10 },
        content: 'secret prompt must not persist',
      },
    },
    {
      type: 'assistant',
      timestamp: new Date(now + 1_000).toISOString(),
      session_id: 'claude-session',
      message: {
        id: 'message-1',
        usage: {
          input_tokens: 70,
          cache_read_input_tokens: 5,
          cache_creation: { ephemeral_5m_input_tokens: 2 },
          output_tokens: 15,
          reasoning_output_tokens: 3,
        },
      },
    },
  ])

  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now })
  const scan = await reader.scan()
  assert.equal(scan.filesScanned, 2)
  assert.equal(scan.recordsParsed, 3)
  assert.equal(scan.recordsImported, 3)

  const summary = store.getSummary()
  assert.equal(summary.totals.tokenInput, 227)
  assert.equal(summary.totals.tokenOutput, 50)
  assert.equal(summary.tokenQuality, 'exact')
  const claude = summary.agents.find(agent => agent.adapterId === 'claude-code')!
  assert.equal(claude.tokenInput, 77)
  assert.equal(claude.tokenOutput, 15)
  const codex = summary.agents.find(agent => agent.adapterId === 'codex')!
  assert.equal(codex.tokenInput, 150)
  assert.equal(codex.tokenOutput, 35)
  const otherPetSummary = store.getSummary('another-pet')
  assert.equal(otherPetSummary.totals.tokenInput, 227)
  assert.equal(otherPetSummary.totals.tokenOutput, 50)
  assert.equal(JSON.stringify(store.getExport()).includes('secret prompt'), false)
})

test('attributes local Codex and Claude usage to the routed project via cwd', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, {
    now: () => now,
    localDate: () => '2026-08-13',
  })
  t.after(() => { store.close(); fixture.cleanup() })

  const projectA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const codexCwd = 'C:\\Users\\dgh\\Desktop\\agent-pets'
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', 'session.jsonl'), [
    { type: 'session_meta', payload: { cwd: codexCwd } },
    {
      type: 'event_msg',
      timestamp: new Date(now).toISOString(),
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 40, output_tokens: 8 },
          total_token_usage: { input_tokens: 40, output_tokens: 8 },
        },
      },
    },
  ])
  writeJsonl(path.join(fixture.home, '.claude', 'projects', 'project', 'session.jsonl'), [
    {
      type: 'assistant',
      timestamp: new Date(now).toISOString(),
      session_id: 'claude-session',
      cwd: codexCwd,
      message: { id: 'message-1', usage: { input_tokens: 60, output_tokens: 12 } },
    },
  ])

  const projectRouting = {
    trackSeen: (value: unknown) => (value === codexCwd ? { projectId: projectA } : null),
  }
  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now, projectRouting })
  const scan = await reader.scan()
  assert.equal(scan.recordsImported, 2)

  const scoped = store.getSummary(undefined, projectA)
  assert.equal(scoped.totals.tokenInput, 100)
  assert.equal(scoped.totals.tokenOutput, 20)

  const unscoped = store.getSummary()
  assert.equal(unscoped.totals.tokenInput, 100)
  assert.equal(unscoped.totals.tokenOutput, 20)

  const otherProject = store.getSummary(undefined, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  assert.equal(otherProject.totals.tokenInput, 0)
  assert.equal(otherProject.totals.tokenOutput, 0)
})

test('a Codex cumulative-counter reset rebases the baseline instead of overcounting', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, {
    now: () => now,
    localDate: () => '2026-08-13',
  })
  t.after(() => { store.close(); fixture.cleanup() })

  const codexUsageRecord = (offsetMs: number, input: number, output: number) => ({
    type: 'event_msg',
    timestamp: new Date(now + offsetMs).toISOString(),
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: input, output_tokens: output },
        total_token_usage: { input_tokens: input, output_tokens: output },
      },
    },
  })
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', 'session.jsonl'), [
    codexUsageRecord(0, 1_000, 200), // baseline
    // Context compaction/resume rebases the cumulative counter down. The old
    // behaviour would have counted this entire smaller total as fresh spend
    // (an extra 300/60 on top of the 1000/200 already recorded) instead of
    // rebasing to it with zero new tokens.
    codexUsageRecord(1_000, 300, 60),
    // Once the (now lower) baseline is exceeded again, the delta must be
    // computed against the rebased total, not the stale pre-reset one.
    codexUsageRecord(2_000, 350, 70),
  ])

  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now })
  const scan = await reader.scan()
  assert.equal(scan.recordsImported, 2) // the reset event itself imports nothing

  const summary = store.getSummary()
  assert.equal(summary.totals.tokenInput, 1_050) // 1000 + 0 (reset) + 50
  assert.equal(summary.totals.tokenOutput, 210) // 200 + 0 (reset) + 10
})

test('local usage scanning registers a project that has never sent a live event', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, {
    now: () => now,
    localDate: () => '2026-08-13',
  })
  t.after(() => { store.close(); fixture.cleanup() })

  const codexCwd = 'C:\\Users\\dgh\\Desktop\\agent-pets'
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', 'session.jsonl'), [
    { type: 'session_meta', payload: { cwd: codexCwd } },
    {
      type: 'event_msg',
      timestamp: new Date(now).toISOString(),
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 40, output_tokens: 8 },
          total_token_usage: { input_tokens: 40, output_tokens: 8 },
        },
      },
    },
  ])

  const seenProjects: string[] = []
  const projectRouting = {
    // A project the reader has never registered before must still get an
    // entry back - this is what makes the History project filter able to
    // show it at all, instead of the token total being correct but
    // permanently unreachable.
    trackSeen: (value: unknown) => {
      if (value !== codexCwd) return null
      seenProjects.push(value)
      return { projectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
    },
  }
  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now, projectRouting })
  await reader.scan()
  assert.equal(seenProjects.length, 1)
})

test('clear history establishes a local usage cutoff and later log entries can be imported', async t => {
  const fixture = setup()
  let now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, {
    now: () => now,
    localDate: () => '2026-08-13',
  })
  t.after(() => { store.close(); fixture.cleanup() })
  const filePath = path.join(fixture.home, '.codex', 'sessions', 'session.jsonl')
  writeJsonl(filePath, [{
    type: 'event_msg',
    timestamp: new Date(now).toISOString(),
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: 12, output_tokens: 3 },
        total_token_usage: { input_tokens: 12, output_tokens: 3 },
      },
    },
  }])
  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now })
  assert.equal((await reader.scan()).recordsImported, 1)
  store.clear()
  assert.equal((await reader.scan()).recordsImported, 0)
  assert.equal(store.getSummary().totals.tokenInput, 0)

  now += 2_000
  fs.appendFileSync(filePath, `${JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(now - 1_000).toISOString(),
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: 20, output_tokens: 5 },
        total_token_usage: { input_tokens: 20, output_tokens: 5 },
      },
    },
  })}\n`, 'utf8')
  assert.equal((await reader.scan()).recordsImported, 1)
  assert.equal(store.getSummary().totals.tokenInput, 8)
  assert.equal(store.getSummary().totals.tokenOutput, 2)
})
