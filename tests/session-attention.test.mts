import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSession } from '../src/types/agent.ts'
import { compareAttention, mostUrgentSession, summarizeFamilies, truncateProject } from '../src/utils/session-attention.ts'

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
  assert.equal(summary[0]?.top.key, 'codex:19999')
  assert.ok(performance.now() - startedAt < 500)
})

test('project names are truncated by character, not UTF-16 unit', () => {
  assert.equal(truncateProject('short'), 'short')
  assert.equal(truncateProject('a'.repeat(30)), `${'a'.repeat(23)}…`)
  assert.equal(truncateProject('專案'.repeat(20), 5), '專案專案…')
  assert.equal(Array.from(truncateProject('😀'.repeat(30))).length, 24)
})
