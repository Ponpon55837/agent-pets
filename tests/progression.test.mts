import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgressionStore } from '../electron/progression.ts'
import {
  evolutionStageForLevel,
  levelForTotalXp,
  totalXpForLevel,
  xpToNext,
} from '../src/types/progression.ts'

function event(state: 'thinking' | 'tool-running' | 'success' | 'error', timestamp: number, sessionId = 'session-1') {
  return {
    source: 'codex' as const,
    sessionId,
    state,
    timestamp,
  }
}

function withStore<T>(work: (store: ProgressionStore, path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-'))
  const path = join(directory, 'progression.sqlite')
  const store = new ProgressionStore(path, { now: () => 1_700_000_000_000 })
  try {
    return work(store, path)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('progression policy derives levels and evolution without floating point state', () => {
  assert.equal(xpToNext(1), 100)
  assert.equal(totalXpForLevel(5), 550)
  assert.equal(levelForTotalXp(549), 4)
  assert.equal(levelForTotalXp(550), 5)
  assert.equal(evolutionStageForLevel(1), 'egg')
  assert.equal(evolutionStageForLevel(5), 'baby')
  assert.equal(evolutionStageForLevel(35), 'master')
})

test('completed sessions award XP once and survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-progression-restart-'))
  const path = join(directory, 'progression.sqlite')
  const first = new ProgressionStore(path)
  const firstResult = first.handleEvent(event('success', Date.now()))
  assert.equal(firstResult.awards.reduce((sum, award) => sum + award.amount, 0), 30)
  assert.equal(firstResult.snapshot.totalXp, 30)
  first.close()

  const second = new ProgressionStore(path)
  const duplicate = second.handleEvent(event('success', Date.now()))
  assert.equal(duplicate.awards.length, 0)
  assert.equal(duplicate.snapshot.totalXp, 30)
  second.close()
  rmSync(directory, { recursive: true, force: true })
})

test('failed sessions do not award permanent XP', () => {
  withStore((store) => {
    const result = store.handleEvent(event('error', Date.now()))
    assert.equal(result.awards.length, 0)
    assert.equal(result.snapshot.totalXp, 0)
  })
})

test('observed active time is capped per session and idempotent', () => {
  withStore((store) => {
    const start = 1_700_000_000_000
    store.handleEvent(event('thinking', start, 'active-session'))
    let result = store.handleEvent(event('tool-running', start + 5 * 60 * 1000, 'active-session'))
    let awarded = result
    for (let minute = 10; minute <= 35; minute += 5) {
      result = store.handleEvent(event('tool-running', start + minute * 60 * 1000, 'active-session'))
      if (result.awards.length > 0) awarded = result
    }
    assert.equal(awarded.awards.reduce((sum, award) => sum + award.amount, 0), 2)
    const duplicate = store.handleEvent(event('tool-running', start + 31 * 60 * 1000, 'active-session'))
    assert.equal(duplicate.awards.length, 0)
    assert.equal(duplicate.snapshot.totalXp, 2)
  })
})

test('streak increments only on the next local day', () => {
  withStore((store) => {
    const dayOne = new Date(2026, 0, 1, 12).getTime()
    const dayTwo = new Date(2026, 0, 2, 12).getTime()
    const first = store.handleEvent(event('success', dayOne, 'day-one'))
    assert.equal(first.snapshot.currentStreak, 1)
    assert.equal(first.snapshot.longestStreak, 1)

    const second = store.handleEvent(event('success', dayTwo, 'day-two'))
    assert.equal(second.snapshot.currentStreak, 2)
    assert.equal(second.snapshot.longestStreak, 2)
    assert.equal(second.awards.some((award) => award.ruleId.endsWith('daily-streak')), true)
  })
})
