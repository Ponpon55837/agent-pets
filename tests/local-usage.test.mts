import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HistoryStore } from '../electron/history.ts'
import {
  createIncrementalLocalUsageParserState,
  isExpiredDateDirectory,
  LocalUsageReader,
  parseIncrementalLocalUsageChunk,
  parseUsageFile,
  type UsageProvider,
} from '../electron/local-usage.ts'

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

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
  // Fresh input excludes prompt-cache tokens, which are reported separately.
  assert.equal(summary.totals.tokenInput, 220)
  assert.equal(summary.totals.tokenCacheRead, 5)
  assert.equal(summary.totals.tokenCacheWrite, 2)
  assert.equal(summary.totals.tokenOutput, 50)
  assert.equal(summary.tokenQuality, 'exact')
  const claude = summary.agents.find(agent => agent.adapterId === 'claude-code')!
  assert.equal(claude.tokenInput, 70)
  assert.equal(claude.tokenCacheRead, 5)
  assert.equal(claude.tokenOutput, 15)
  const codex = summary.agents.find(agent => agent.adapterId === 'codex')!
  assert.equal(codex.tokenInput, 150)
  assert.equal(codex.tokenOutput, 35)
  const otherPetSummary = store.getSummary('another-pet')
  assert.equal(otherPetSummary.totals.tokenInput, 220)
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

test('incremental local usage parsing matches full parsing across 1,000 seeded files and byte boundaries', () => {
  const random = seededRandom(18_301)
  for (let caseIndex = 0; caseIndex < 1_000; caseIndex += 1) {
    const provider: UsageProvider = caseIndex % 2 === 0 ? 'codex' : 'claude-code'
    const lines: string[] = []
    const lineCount = 1 + Math.floor(random() * 6)
    let totalInput = 0
    let totalOutput = 0
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      if (provider === 'codex') {
        if (lineIndex === 0 && caseIndex % 3 === 0) {
          lines.push(JSON.stringify({ type: 'session_meta', payload: { cwd: '/workspace/project' } }))
        }
        totalInput += 1 + Math.floor(random() * 40)
        totalOutput += Math.floor(random() * 20)
        lines.push(JSON.stringify({
          type: 'event_msg',
          timestamp: new Date(1_800_000_000_000 + lineIndex).toISOString(),
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: { input_tokens: totalInput, output_tokens: totalOutput },
              total_token_usage: { input_tokens: totalInput, output_tokens: totalOutput },
            },
          },
        }))
      } else {
        const messageIndex = lineIndex % 2 === 0 ? lineIndex : lineIndex - 1
        lines.push(JSON.stringify({
          type: 'assistant',
          timestamp: new Date(1_800_000_000_000 + lineIndex).toISOString(),
          session_id: `session-${caseIndex}`,
          message: {
            id: `message-${messageIndex}`,
            usage: { input_tokens: 1 + Math.floor(random() * 70), output_tokens: Math.floor(random() * 30) },
            content: '測試文字 boundary',
          },
        }))
      }
    }
    const bytes = Buffer.from(`${lines.join('\n')}\n`, 'utf8')
    const fileKey = `fixture-${caseIndex}`
    const expected = parseUsageFile(provider, fileKey, bytes.toString('utf8'), 1_800_000_000_000, 4_096)
    const state = createIncrementalLocalUsageParserState()
    const actualByKey = new Map<string, ReturnType<typeof parseUsageFile>[number]>()
    let availableEnd = 0
    while (availableEnd < bytes.length) {
      availableEnd = Math.min(bytes.length, availableEnd + 1 + Math.floor(random() * 31))
      const readStart = state.readOffset
      const chunk = bytes.subarray(readStart, availableEnd)
      for (const record of parseIncrementalLocalUsageChunk(
        provider,
        fileKey,
        chunk,
        readStart,
        1_800_000_000_000,
        4_096,
        state,
      )) actualByKey.set(record.dedupeKey, record)
    }
    assert.deepEqual([...actualByKey.values()], expected, `seeded corpus ${caseIndex}`)
    assert.equal(state.readOffset, bytes.length, `resume offset ${caseIndex}`)
  }
})

test('incremental usage scan waits for an incomplete line and resumes after append or file replacement', async t => {
  const fixture = setup()
  let now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { store.close(); fixture.cleanup() })
  const filePath = path.join(fixture.home, '.codex', 'sessions', 'session.jsonl')
  const codexRecord = (input: number) => JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(now).toISOString(),
    payload: { type: 'token_count', info: {
      last_token_usage: { input_tokens: input, output_tokens: 1 },
      total_token_usage: { input_tokens: input, output_tokens: 1 },
    } },
  })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${codexRecord(10)}\n`, 'utf8')
  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now })
  assert.equal((await reader.scan()).recordsImported, 1)
  fs.appendFileSync(filePath, codexRecord(25).slice(0, 24), 'utf8')
  assert.equal((await reader.scan()).recordsImported, 0)
  assert.equal(store.getSummary().totals.tokenInput, 10)
  fs.appendFileSync(filePath, `${codexRecord(25).slice(24)}\n`, 'utf8')
  assert.equal((await reader.scan()).recordsImported, 1)
  assert.equal(store.getSummary().totals.tokenInput, 25)

  store.clear()
  now += 2_000
  const replacementPath = `${filePath}.replacement`
  fs.writeFileSync(replacementPath, `${codexRecord(7)}\n`, 'utf8')
  fs.renameSync(replacementPath, filePath)
  assert.equal((await reader.scan()).recordsImported, 1)
  assert.equal(store.getSummary().totals.tokenInput, 7)
})

test('incremental byte budgets charge only bytes read after the cached offset', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { store.close(); fixture.cleanup() })

  const directory = path.join(fixture.home, '.codex', 'sessions')
  const first = path.join(directory, 'first.jsonl')
  const second = path.join(directory, 'second.jsonl')
  const filler = (index: number) => ({ type: 'user', message: { content: `fixture-${index}-` + 'x'.repeat(150) } })
  writeJsonl(first, Array.from({ length: 300 }, (_, index) => filler(index)))
  writeJsonl(second, Array.from({ length: 250 }, (_, index) => filler(index + 300)))
  assert.ok(fs.statSync(first).size > 50 * 1024)
  assert.ok(fs.statSync(second).size > 40 * 1024)

  const reader = new LocalUsageReader({
    homeDir: fixture.home,
    history: store,
    now: () => now,
    maxFileBytes: 64 * 1024,
    maxTotalBytes: 64 * 1024,
  })
  const initial = await reader.scan()
  assert.equal(initial.filesScanned, 1)
  assert.equal(initial.filesSkipped, 1)

  fs.appendFileSync(first, `${JSON.stringify(filler(900))}\n`)
  const resumed = await reader.scan()
  assert.equal(resumed.filesScanned, 2)
  assert.equal(resumed.filesSkipped, 0)
})

test('a file larger than maxFileBytes is consumed in chunks instead of being skipped, and scans expose diagnostics', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { store.close(); fixture.cleanup() })

  const file = path.join(fixture.home, '.claude', 'projects', 'big', 'session.jsonl')
  const assistant = (id: string) => ({
    type: 'assistant',
    timestamp: new Date(now).toISOString(),
    session_id: 'big',
    message: { id, usage: { input_tokens: 10, output_tokens: 5 } },
  })
  const filler = (index: number) => ({ type: 'user', message: { content: `f-${index}-` + 'x'.repeat(200) } })
  writeJsonl(file, [
    ...Array.from({ length: 400 }, (_, index) => filler(index)),
    assistant('late-message'),
  ])
  assert.ok(fs.statSync(file).size > 64 * 1024)

  const reader = new LocalUsageReader({
    homeDir: fixture.home,
    history: store,
    now: () => now,
    maxFileBytes: 64 * 1024,
    maxTotalBytes: 1024 * 1024,
  })
  assert.equal(reader.getDiagnostics(), null)
  let imported = 0
  for (let pass = 0; pass < 4; pass += 1) {
    const scan = await reader.scan()
    assert.equal(scan.filesSkipped, 0)
    imported += scan.recordsImported
  }
  assert.equal(imported, 1)
  assert.equal(store.getSummary().totals.tokenInput, 10)
  const diagnostics = reader.getDiagnostics()
  assert.ok(diagnostics && diagnostics.durationMs >= 0 && diagnostics.finishedAt > 0)
})

test('cache-heavy Claude and Codex logs keep cache tokens out of the headline input total', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { store.close(); fixture.cleanup() })

  writeJsonl(path.join(fixture.home, '.claude', 'projects', 'p', 's.jsonl'), [{
    type: 'assistant',
    timestamp: new Date(now).toISOString(),
    session_id: 's',
    message: { id: 'm1', usage: { input_tokens: 10, cache_read_input_tokens: 900_000, cache_creation_input_tokens: 40, output_tokens: 20 } },
  }])
  const codex = (input: number, cached: number, output: number) => ({
    type: 'event_msg',
    timestamp: new Date(now).toISOString(),
    payload: { type: 'token_count', info: {
      last_token_usage: { input_tokens: input },
      total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
    } },
  })
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', 'c.jsonl'), [codex(1000, 800, 50), codex(1500, 1200, 80)])

  await new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now }).scan()
  const totals = store.getSummary().totals
  assert.equal(totals.tokenInput, 10 + 300)
  assert.equal(totals.tokenCacheRead, 900_000 + 1200)
  assert.equal(totals.tokenCacheWrite, 40)
  assert.equal(totals.tokenOutput, 20 + 80)
})

test('large file is parsed in slices with the same totals, one project lookup per cwd, and event-loop yields', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { store.close(); fixture.cleanup() })

  const RECORDS = 6_000
  const records: unknown[] = []
  let inputTotal = 0
  let outputTotal = 0
  for (let index = 0; index < RECORDS; index += 1) {
    const input = 10 + (index % 7)
    inputTotal += input
    outputTotal += 3
    records.push({
      type: 'assistant',
      timestamp: new Date(now - 1_000 + index).toISOString(),
      session_id: 'claude-big',
      cwd: index % 2 === 0 ? '/nonexistent/worktree-a' : '/nonexistent/worktree-b',
      message: { id: `m-${index}`, usage: { input_tokens: input, output_tokens: 3 }, content: 'x'.repeat(400) },
    })
  }
  writeJsonl(path.join(fixture.home, '.claude', 'projects', 'big', 'session.jsonl'), records)
  assert.ok(fs.statSync(path.join(fixture.home, '.claude', 'projects', 'big', 'session.jsonl')).size > 2 * 1024 * 1024)

  const lookups: string[] = []
  const projectRouting = {
    trackSeen: (cwd: string) => { lookups.push(cwd); return null },
    resolvePath: () => null,
  }
  let yields = 0
  const originalSetImmediate = globalThis.setImmediate
  globalThis.setImmediate = ((fn: () => void, ...args: unknown[]) => { yields += 1; return originalSetImmediate(fn, ...(args as [])) }) as typeof setImmediate
  try {
    const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now, projectRouting: projectRouting as never })
    const result = await reader.scan()
    assert.equal(result.recordsImported, RECORDS)
  } finally {
    globalThis.setImmediate = originalSetImmediate
  }
  assert.deepEqual([...lookups].sort(), ['/nonexistent/worktree-a', '/nonexistent/worktree-b'])
  assert.ok(yields >= 3 + Math.floor(RECORDS / 500) - 1, `yielded ${yields} times`)
  const totals = store.getSummary('aang-airbender', undefined, 7).totals
  assert.equal(totals.tokenInput, inputTotal)
  assert.equal(totals.tokenOutput, outputTotal)
  // A second scan finds nothing new.
  const second = await new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now }).scan()
  assert.equal(second.recordsImported, 0)
})

test('recordTokenUsageBatch equals sequential recordTokenUsage for new, moved and repeated records', t => {
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const sequentialDb = setup()
  const batchedDb = setup()
  const options = { now: () => now, localDate: (ts: number) => ts < now ? '2026-08-12' : '2026-08-13' }
  const sequential = new HistoryStore(sequentialDb.database, options)
  const batched = new HistoryStore(batchedDb.database, options)
  t.after(() => { sequential.close(); batched.close(); sequentialDb.cleanup(); batchedDb.cleanup() })
  const record = (id: string, at: number, input: number, quality: 'exact' | 'estimated', projectId?: string) => ({
    adapterId: 'claude-code', agentId: 'claude', sourceEventId: id, occurredAt: at, input, output: 2, cacheRead: 1, quality, projectId,
  })
  const projectA = 'a'.repeat(32)
  const rounds = [
    [record('1', now - 5000, 10, 'estimated'), record('2', now - 4000, 20, 'exact', projectA), record('3', now, 5, 'exact')],
    // repeat, change tokens, and move record 3 to the previous day
    [record('1', now - 5000, 10, 'estimated'), record('2', now - 4000, 25, 'exact', projectA), record('3', now - 9000, 5, 'exact')],
  ]
  for (const round of rounds) {
    const expected = round.map(item => sequential.recordTokenUsage(item)).filter(Boolean).length
    assert.equal(batched.recordTokenUsageBatch(round), expected)
  }
  assert.deepEqual(batched.getSummary('aang-airbender', undefined, 7), { ...sequential.getSummary('aang-airbender', undefined, 7), generatedAt: batched.getSummary().generatedAt })
  assert.deepEqual(batched.getSummary('aang-airbender', projectA, 7).totals, sequential.getSummary('aang-airbender', projectA, 7).totals)
})

test('Codex date directories older than the cutoff are never entered', () => {
  const cutoff = Date.UTC(2026, 7, 13)
  assert.equal(isExpiredDateDirectory(['2025'], cutoff), true)
  assert.equal(isExpiredDateDirectory(['2026'], cutoff), false)
  assert.equal(isExpiredDateDirectory(['2026', '05'], cutoff), true)
  assert.equal(isExpiredDateDirectory(['2026', '08'], cutoff), false)
  assert.equal(isExpiredDateDirectory(['2026', '08', '12'], cutoff), false, 'inside the one-day slack')
  assert.equal(isExpiredDateDirectory(['2026', '08', '10'], cutoff), true)
  assert.equal(isExpiredDateDirectory(['2026', '08', '01'], cutoff), true)
  assert.equal(isExpiredDateDirectory(['misc'], cutoff), false)
  assert.equal(isExpiredDateDirectory(['2026', 'x'], cutoff), false)
})

test('cached directory listings still see new files, appended data, and skip expired Codex days', async t => {
  const fixture = setup()
  const now = Date.UTC(2026, 7, 13, 1, 0, 0)
  const store = new HistoryStore(fixture.database, { now: () => now, localDate: () => '2026-08-13' })
  t.after(() => { store.close(); fixture.cleanup() })
  const codex = (id: string, input: number) => ({
    type: 'event_msg', timestamp: new Date(now).toISOString(), session_id: id,
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 1 }, total_token_usage: { input_tokens: input, output_tokens: 1 } } },
  })
  const day = path.join(fixture.home, '.codex', 'sessions', '2026', '08', '13')
  writeJsonl(path.join(day, 'a.jsonl'), [codex('a', 100)])
  writeJsonl(path.join(fixture.home, '.codex', 'sessions', '2020', '01', '01', 'old.jsonl'), [codex('old', 999)])
  const reader = new LocalUsageReader({ homeDir: fixture.home, history: store, now: () => now })
  assert.equal((await reader.scan()).recordsImported, 1)
  assert.equal((await reader.scan()).recordsImported, 0)
  writeJsonl(path.join(day, 'b.jsonl'), [codex('b', 50)])
  assert.equal((await reader.scan()).recordsImported, 1, 'new file in a cached directory')
  fs.appendFileSync(path.join(day, 'a.jsonl'), `${JSON.stringify({ ...codex('a', 200), payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 7, output_tokens: 1 }, total_token_usage: { input_tokens: 107, output_tokens: 2 } } } })}\n`)
  assert.equal((await reader.scan()).recordsImported, 1, 'appended record in an unchanged directory')
  assert.equal(store.getSummary('aang-airbender', undefined, 7).totals.tokenInput, 157)
})
