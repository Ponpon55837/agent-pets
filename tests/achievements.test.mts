import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AchievementStore } from '../electron/achievements.ts'
import {
  ACHIEVEMENT_DEFINITIONS,
  evaluateAchievements,
  type AchievementEvaluationContext,
} from '../src/types/achievement.ts'

const BASE_TIME = Date.UTC(2026, 0, 1, 12)

function localDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function localHour(timestamp: number): number {
  return new Date(timestamp).getUTCHours()
}

function event(
  state: 'thinking' | 'success',
  timestamp: number,
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    source: 'codex' as const,
    sessionId,
    state,
    timestamp,
    ...overrides,
  }
}

function withStore<T>(work: (store: AchievementStore, path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-achievements-'))
  const path = join(directory, 'achievements.sqlite')
  let clock = BASE_TIME
  const store = new AchievementStore(path, {
    now: () => clock,
    localDate,
    localHour,
  })
  try {
    return work(store, path)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('registry exposes the ten versioned, presentation-only rules', () => {
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 10)
  assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map(definition => definition.id)).size, 10)

  const base: AchievementEvaluationContext = {
    completedSessions: 0,
    completedSessionsToday: 0,
    tokenTotal: 0,
    tokenQuality: 'none',
    adapterCount: 0,
    activeDays: 0,
    nightOwlCompletion: false,
    currentStreak: 0,
    level: 1,
  }
  assert.deepEqual(evaluateAchievements(base), [])
  const unlocked = evaluateAchievements({
    ...base,
    completedSessions: 100,
    completedSessionsToday: 20,
    tokenTotal: 1_000_000,
    tokenQuality: 'estimated',
    adapterCount: 3,
    activeDays: 30,
    nightOwlCompletion: true,
    currentStreak: 7,
    level: 20,
  })
  assert.equal(unlocked.length, 10)
  assert.equal(unlocked.find(item => item.id === 'one_million')?.tokenQuality, 'estimated')
})

test('unlocks are idempotent per pet and survive a store restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-pets-achievements-restart-'))
  const path = join(directory, 'achievements.sqlite')
  const first = new AchievementStore(path, { localDate, localHour })
  const firstUnlocks = first.recordEvent(event('success', BASE_TIME, 'first-session'), 'wolf')
  assert.equal(firstUnlocks.some(unlock => unlock.achievementId === 'hello_world'), true)
  assert.equal(first.recordEvent(event('success', BASE_TIME, 'first-session'), 'wolf').length, 0)
  assert.equal(first.getSnapshot('wolf').totalUnlocked, 1)
  first.close()

  const second = new AchievementStore(path, { localDate, localHour })
  assert.equal(second.getSnapshot('wolf').totalUnlocked, 1)
  assert.equal(second.recordEvent(event('success', BASE_TIME, 'second-session'), 'wolf').length, 0)
  second.close()
  rmSync(directory, { recursive: true, force: true })
})

test('Night Owl uses the injected local hour boundary', () => {
  withStore((store) => {
    const beforeBoundary = store.recordEvent(
      event('success', Date.UTC(2026, 0, 2, 4, 59), 'night-session'),
      'wolf',
    )
    assert.equal(beforeBoundary.some(unlock => unlock.achievementId === 'night_owl'), true)

    const afterBoundary = store.recordEvent(
      event('success', Date.UTC(2026, 0, 2, 5), 'day-session'),
      'aang-airbender',
    )
    assert.equal(afterBoundary.some(unlock => unlock.achievementId === 'night_owl'), false)
  })
})

test('token achievement records quality and ignores replayed source events', () => {
  withStore((store) => {
    const exactEvent = event('thinking', BASE_TIME, 'token-session', {
      adapterId: 'codex',
      eventId: 'token-event-1',
      tokenUsage: { input: 1_000_000, output: 0, quality: 'exact' },
    })
    const first = store.recordEvent(exactEvent, 'wolf')
    assert.equal(first.find(unlock => unlock.achievementId === 'one_million')?.tokenQuality, 'exact')
    assert.equal(store.recordEvent(exactEvent, 'wolf').length, 0)
    assert.equal(store.getSnapshot('wolf').achievements.find(item => item.id === 'one_million')?.tokenQuality, 'exact')

    const estimated = event('thinking', BASE_TIME, 'estimated-session', {
      adapterId: 'claude-code',
      eventId: 'token-event-2',
      tokenUsage: { input: 1_000_000, output: 0, quality: 'estimated' },
    })
    const estimatedUnlocks = store.recordEvent(estimated, 'aang-airbender')
    assert.equal(estimatedUnlocks.find(unlock => unlock.achievementId === 'one_million')?.tokenQuality, 'estimated')
  })
})

test('adapter, busy-day, streak, and active-day rules use pet-scoped aggregates', () => {
  withStore((store) => {
    const adapters = [
      ['codex', 'codex-session'],
      ['claude-code', 'claude-session'],
      ['opencode', 'opencode-session'],
    ] as const
    const polyglotUnlocks = adapters.flatMap(([adapterId, sessionId], index) => store.recordEvent(
      event('success', BASE_TIME + index * 1_000, sessionId, { adapterId }),
      'wolf',
    ))
    assert.equal(polyglotUnlocks.some(unlock => unlock.achievementId === 'polyglot_agents'), true)

    const day = Date.UTC(2026, 0, 3, 12)
    let busyUnlocks: ReturnType<AchievementStore['recordEvent']> = []
    for (let index = 0; index < 20; index += 1) {
      busyUnlocks = busyUnlocks.concat(store.recordEvent(
        event('success', day + index * 1_000, `busy-${index}`),
        'busy-pet',
      ))
    }
    assert.equal(busyUnlocks.some(unlock => unlock.achievementId === 'busy_day'), true)

    const streak = store.recordEvent(
      event('success', day + 21_000, 'streak-session'),
      'streak-pet',
      {
        petId: 'streak-pet',
        totalXp: 0,
        level: 1,
        xpIntoLevel: 0,
        xpToNext: 100,
        evolutionStage: 'egg',
        currentStreak: 7,
        longestStreak: 7,
        updatedAt: day,
      },
    )
    assert.equal(streak.some(unlock => unlock.achievementId === 'loyal_companion'), true)

    let activeDayUnlocks: ReturnType<AchievementStore['recordEvent']> = []
    for (let index = 0; index < 30; index += 1) {
      activeDayUnlocks = activeDayUnlocks.concat(store.recordEvent(
        event('success', Date.UTC(2026, 1, 1 + index, 12), `active-${index}`),
        'old-pet',
      ))
    }
    assert.equal(activeDayUnlocks.some(unlock => unlock.achievementId === 'old_friend'), true)
    assert.equal(store.getSnapshot('wolf').totalUnlocked >= 2, true)
    assert.equal(store.getSnapshot('busy-pet').totalUnlocked, 2)
  })
})

test('history reconciliation backfills unique sessions without duplicate unlocks', () => {
  withStore((store) => {
    const existing = event('success', BASE_TIME, 'session-0', { projectId: 'a'.repeat(32) })
    assert.equal(store.recordEvent(existing, 'wolf').some(unlock => unlock.achievementId === 'hello_world'), true)
    const facts = Array.from({ length: 100 }, (_, index) => ({
      petId: 'wolf',
      source: 'codex',
      sessionId: `session-${index}`,
      projectId: 'a'.repeat(32),
      adapterId: 'codex',
      completedAt: BASE_TIME + index * 1_000,
    }))
    const unlocks = store.reconcileCompletedSessions(facts)
    assert.equal(unlocks.some(unlock => unlock.achievementId === 'getting_serious'), true)
    assert.equal(store.getSnapshot('wolf').achievements.find(item => item.id === 'getting_serious')?.unlocked, true)
    assert.equal(store.reconcileCompletedSessions(facts).length, 0)
  })
})
