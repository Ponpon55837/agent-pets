export type EvolutionStage = 'egg' | 'baby' | 'teen' | 'adult' | 'master'

export interface ProgressionSnapshot {
  petId: string
  totalXp: number
  level: number
  xpIntoLevel: number
  xpToNext: number
  evolutionStage: EvolutionStage
  currentStreak: number
  longestStreak: number
  lastActiveLocalDate?: string
  updatedAt: number
}

export interface ProgressionAward {
  ruleId: string
  amount: number
}

export interface ProgressionEventResult {
  snapshot: ProgressionSnapshot
  awards: ProgressionAward[]
}

export const XP_POLICY_VERSION = 'v1'

export const XP_RULES = Object.freeze({
  sessionCompleted: 20,
  firstCompletionOfDay: 10,
  activeCodingThirtyMinutes: 2,
  dailyStreak: 5,
})

export const ACTIVE_CODING_INTERVAL_MS = 30 * 60 * 1000
export const ACTIVE_CODING_MAX_POINTS_PER_SESSION = 10

export function xpToNext(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level))
  return 100 + 25 * (safeLevel - 1)
}

export function totalXpForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level))
  const steps = safeLevel - 1
  return (steps * (200 + 25 * (safeLevel - 2))) / 2
}

export function levelForTotalXp(totalXp: number): number {
  const safeXp = Math.max(0, Math.floor(totalXp))
  let level = 1
  while (safeXp >= totalXpForLevel(level + 1)) level += 1
  return level
}

export function evolutionStageForLevel(level: number): EvolutionStage {
  if (level >= 35) return 'master'
  if (level >= 20) return 'adult'
  if (level >= 10) return 'teen'
  if (level >= 5) return 'baby'
  return 'egg'
}

export function progressionForTotalXp(
  petId: string,
  totalXp: number,
  currentStreak: number,
  longestStreak: number,
  lastActiveLocalDate: string | undefined,
  updatedAt: number,
): ProgressionSnapshot {
  const safeXp = Math.max(0, Math.floor(totalXp))
  const level = levelForTotalXp(safeXp)
  return {
    petId,
    totalXp: safeXp,
    level,
    xpIntoLevel: safeXp - totalXpForLevel(level),
    xpToNext: xpToNext(level),
    evolutionStage: evolutionStageForLevel(level),
    currentStreak: Math.max(0, Math.floor(currentStreak)),
    longestStreak: Math.max(0, Math.floor(longestStreak)),
    ...(lastActiveLocalDate ? { lastActiveLocalDate } : {}),
    updatedAt,
  }
}
