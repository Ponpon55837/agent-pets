export type AchievementId =
  | 'hello_world'
  | 'getting_serious'
  | 'night_owl'
  | 'one_million'
  | 'polyglot_agents'
  | 'busy_day'
  | 'loyal_companion'
  | 'old_friend'
  | 'level_10'
  | 'level_20'

export type AchievementTranslationKey =
  | 'achievementHelloWorld'
  | 'achievementGettingSerious'
  | 'achievementNightOwl'
  | 'achievementOneMillion'
  | 'achievementPolyglotAgents'
  | 'achievementBusyDay'
  | 'achievementLoyalCompanion'
  | 'achievementOldFriend'
  | 'achievementLevel10'
  | 'achievementLevel20'
  | 'achievementHelloWorldHelp'
  | 'achievementGettingSeriousHelp'
  | 'achievementNightOwlHelp'
  | 'achievementOneMillionHelp'
  | 'achievementPolyglotAgentsHelp'
  | 'achievementBusyDayHelp'
  | 'achievementLoyalCompanionHelp'
  | 'achievementOldFriendHelp'
  | 'achievementLevel10Help'
  | 'achievementLevel20Help'

export type AchievementTokenQuality = 'none' | 'estimated' | 'exact'
export type AchievementVisualReward = 'sparkle' | 'badge'

export interface AchievementEvaluationContext {
  completedSessions: number
  completedSessionsToday: number
  tokenTotal: number
  tokenQuality: AchievementTokenQuality
  adapterCount: number
  activeDays: number
  nightOwlCompletion: boolean
  currentStreak: number
  level: number
}

export interface AchievementEvaluation {
  id: AchievementId
  tokenQuality?: Exclude<AchievementTokenQuality, 'none'>
}

export interface AchievementDefinition {
  id: AchievementId
  version: number
  titleKey: AchievementTranslationKey
  descriptionKey: AchievementTranslationKey
  visualReward: AchievementVisualReward
  evaluate: (context: AchievementEvaluationContext) => AchievementEvaluation | null
}

export interface AchievementUnlock {
  petId: string
  achievementId: AchievementId
  version: number
  unlockedAt: number
  titleKey: AchievementTranslationKey
  descriptionKey: AchievementTranslationKey
  visualReward: AchievementVisualReward
  tokenQuality: AchievementTokenQuality
}

export interface AchievementView {
  id: AchievementId
  version: number
  titleKey: AchievementTranslationKey
  descriptionKey: AchievementTranslationKey
  visualReward: AchievementVisualReward
  unlocked: boolean
  unlockedAt?: number
  tokenQuality: AchievementTokenQuality
}

export interface AchievementSnapshot {
  schemaVersion: 1
  generatedAt: number
  petId: string
  totalUnlocked: number
  achievements: AchievementView[]
}

const definitions: readonly AchievementDefinition[] = [
  {
    id: 'hello_world',
    version: 1,
    titleKey: 'achievementHelloWorld',
    descriptionKey: 'achievementHelloWorldHelp',
    visualReward: 'sparkle',
    evaluate: context => context.completedSessions >= 1 ? { id: 'hello_world' } : null,
  },
  {
    id: 'getting_serious',
    version: 1,
    titleKey: 'achievementGettingSerious',
    descriptionKey: 'achievementGettingSeriousHelp',
    visualReward: 'badge',
    evaluate: context => context.completedSessions >= 100 ? { id: 'getting_serious' } : null,
  },
  {
    id: 'night_owl',
    version: 1,
    titleKey: 'achievementNightOwl',
    descriptionKey: 'achievementNightOwlHelp',
    visualReward: 'sparkle',
    evaluate: context => context.nightOwlCompletion ? { id: 'night_owl' } : null,
  },
  {
    id: 'one_million',
    version: 1,
    titleKey: 'achievementOneMillion',
    descriptionKey: 'achievementOneMillionHelp',
    visualReward: 'badge',
    evaluate: context => context.tokenTotal >= 1_000_000 && context.tokenQuality !== 'none'
      ? { id: 'one_million', tokenQuality: context.tokenQuality }
      : null,
  },
  {
    id: 'polyglot_agents',
    version: 1,
    titleKey: 'achievementPolyglotAgents',
    descriptionKey: 'achievementPolyglotAgentsHelp',
    visualReward: 'badge',
    evaluate: context => context.adapterCount >= 3 ? { id: 'polyglot_agents' } : null,
  },
  {
    id: 'busy_day',
    version: 1,
    titleKey: 'achievementBusyDay',
    descriptionKey: 'achievementBusyDayHelp',
    visualReward: 'sparkle',
    evaluate: context => context.completedSessionsToday >= 20 ? { id: 'busy_day' } : null,
  },
  {
    id: 'loyal_companion',
    version: 1,
    titleKey: 'achievementLoyalCompanion',
    descriptionKey: 'achievementLoyalCompanionHelp',
    visualReward: 'badge',
    evaluate: context => context.currentStreak >= 7 ? { id: 'loyal_companion' } : null,
  },
  {
    id: 'old_friend',
    version: 1,
    titleKey: 'achievementOldFriend',
    descriptionKey: 'achievementOldFriendHelp',
    visualReward: 'badge',
    evaluate: context => context.activeDays >= 30 ? { id: 'old_friend' } : null,
  },
  {
    id: 'level_10',
    version: 1,
    titleKey: 'achievementLevel10',
    descriptionKey: 'achievementLevel10Help',
    visualReward: 'sparkle',
    evaluate: context => context.level >= 10 ? { id: 'level_10' } : null,
  },
  {
    id: 'level_20',
    version: 1,
    titleKey: 'achievementLevel20',
    descriptionKey: 'achievementLevel20Help',
    visualReward: 'badge',
    evaluate: context => context.level >= 20 ? { id: 'level_20' } : null,
  },
]

export const ACHIEVEMENT_DEFINITIONS = Object.freeze(definitions)

export function evaluateAchievements(context: AchievementEvaluationContext): AchievementEvaluation[] {
  return ACHIEVEMENT_DEFINITIONS
    .map(definition => definition.evaluate(context))
    .filter((result): result is AchievementEvaluation => result !== null)
}
