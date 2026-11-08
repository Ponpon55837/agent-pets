import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSession } from '../src/types/agent.ts'
import { compareAttention, mostUrgentSession, statusLineText, summarizeFamilies, truncateProject } from '../src/utils/session-attention.ts'

function session(key: string, overrides: Partial<AgentSession> = {}): AgentSession {
  const [source, sessionId] = key.split(':') as [AgentSession['source'], string]
  return { key, source, sessionId, state: 'thinking', lastSeenAt: 100, ...overrides }
}

test('attention order is priority, then most recent, then key, whatever the input order', () => {
  const sessions = [
    session('claude:b', { state: 'thinking', lastSeenAt: 900 }),
    session('claude:c', { state: 'waiting-permission', lastSeenAt: 100, project: 'old' }),
    session('claude:d', { state: 'waiting-permission', lastSeenAt: 500, project: 'new' }),
    session('claude:a', { state: 'waiting-permission', lastSeenAt: 500, project: 'tie' }),
  ]
  const expected = ['claude:a', 'claude:d', 'claude:c', 'claude:b']
  assert.deepEqual([...sessions].sort(compareAttention).map(s => s.key), expected)
  assert.deepEqual([...sessions].reverse().sort(compareAttention).map(s => s.key), expected)
  assert.equal(mostUrgentSession(sessions)?.key, 'claude:a')
  assert.equal(mostUrgentSession([...sessions].reverse())?.key, 'claude:a')
  assert.equal(mostUrgentSession([session('codex:x', { state: 'offline' })]), null)
})

test('two busy sessions keep a stable winner while their heartbeats alternate', () => {
  // Regression: with a recency tie-break the top session (and the multi-pet sprite) flipped on
  // every event. Busy sessions now tie-break on firstSeenAt, waiting ones on recency.
  const a = session('claude:a', { state: 'thinking', firstSeenAt: 10, lastSeenAt: 10, routedPetId: 'pet-a' })
  const b = session('claude:b', { state: 'tool-running', firstSeenAt: 20, lastSeenAt: 20, routedPetId: 'pet-b' })
  b.state = 'thinking'
  const winners = new Set<string>()
  for (let tick = 0; tick < 20; tick += 1) {
    const busy = tick % 2 === 0 ? a : b
    busy.lastSeenAt = 100 + tick
    winners.add(summarizeFamilies([a, b])[0]!.top.key)
  }
  assert.deepEqual([...winners], ['claude:a'])

  const waitingOld = session('claude:c', { state: 'waiting-permission', firstSeenAt: 1, lastSeenAt: 50 })
  const waitingNew = session('claude:d', { state: 'waiting-permission', firstSeenAt: 2, lastSeenAt: 60 })
  assert.equal(mostUrgentSession([waitingOld, waitingNew])?.key, 'claude:d')
})

test('family summary names the session that needs you and counts the rest in one pass', () => {
  const summary = summarizeFamilies([
    session('codex:1', { state: 'tool-running' }),
    session('claude:1', { state: 'thinking', lastSeenAt: 999 }),
    session('claude-desktop:2', { state: 'waiting-permission', lastSeenAt: 10, project: 'my-app' }),
    session('claude:3', { state: 'success' }),
    session('claude:4', { state: 'offline', lastSeenAt: 2_000 }),
  ])
  assert.deepEqual(summary.map(family => family.key), ['codex', 'claude'])
  const claude = summary[1]!
  assert.equal(claude.top.key, 'claude-desktop:2')
  assert.equal(claude.top.project, 'my-app')
  assert.equal(claude.count, 3)
  assert.deepEqual([...claude.sources].sort(), ['claude', 'claude-desktop'])
  assert.deepEqual(summarizeFamilies([]), [])
})

test('family summary stays linear for a large session set', () => {
  const sessions = Array.from({ length: 20_000 }, (_, index) => session(`codex:${index}`, { lastSeenAt: index }))
  const startedAt = performance.now()
  const summary = summarizeFamilies(sessions)
  assert.equal(summary[0]?.count, 20_000)
  assert.equal(summary[0]?.top.key, 'codex:0') // busy: oldest first
  assert.ok(performance.now() - startedAt < 500)
})

test('project names are truncated by character, not UTF-16 unit', () => {
  assert.equal(truncateProject('short'), 'short')
  assert.equal(truncateProject('a'.repeat(30)), `${'a'.repeat(23)}…`)
  assert.equal(truncateProject('專案'.repeat(20), 5), '專案專案…')
  assert.equal(Array.from(truncateProject('😀'.repeat(30))).length, 24)
})

test('status line text never carries an other-sessions count and keeps the state whole', () => {
  const busy = statusLineText({ label: 'Claude', variants: ['CLI', 'Desktop'], project: 'a-very-long-project-name-for-layout-testing', count: 3 }, '思考中')
  assert.equal(busy.name, 'Claude')
  assert.equal(busy.project, 'a-very-long-project-nam…')
  assert.equal(busy.full, 'Claude (CLI+Desktop) · a-very-long-project-name-for-layout-testing · 思考中')
  for (const value of Object.values(busy)) assert.doesNotMatch(value, /\(\+\d+\)/)

  const single = statusLineText({ label: 'Codex', variants: ['CLI'], project: 'web', count: 1 }, 'Working')
  assert.deepEqual(single, { name: 'Codex', project: '', full: 'Codex (CLI) · Working' })

  const overall = statusLineText({ label: '', variants: [], count: 0 }, 'Offline')
  assert.deepEqual(overall, { name: '', project: '', full: 'Offline' })
})

test('the pet template no longer renders a (+N) session count', async () => {
  const fs = await import('node:fs')
  const source = fs.readFileSync(new URL('../src/components/DesktopPet.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /line\.count - 1/)
  assert.doesNotMatch(source, /line-more/)
  assert.match(source, /:aria-label="lineAriaLabel\(line\)"/)
})
