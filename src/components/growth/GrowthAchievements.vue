<script setup lang="ts">
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import type { AchievementTokenQuality, AchievementTranslationKey } from '@/types/achievement'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const achievementQualityLabels: Partial<Record<AchievementTokenQuality, Parameters<typeof t>[0]>> = {
  exact: 'achievementTokenExact', estimated: 'achievementTokenEstimated',
}

function achievementText(key: AchievementTranslationKey): string {
  return t(key)
}

function achievementQualityLabel(quality: AchievementTokenQuality): string {
  const key = achievementQualityLabels[quality]
  return key ? t(key) : ''
}
</script>

<template>
  <Card :title="t('achievements')" tone="accent">
    <template #heading>
      <span class="stat-readout">{{ store.achievements?.totalUnlocked ?? 0 }} / {{ store.achievements?.achievements.length ?? 0 }}</span>
    </template>
    <ToggleRow :model-value="store.achievementsEnabled" :label="t('achievementsEnable')" :help="t('achievementsEnableHelp')" @update:model-value="store.setAchievementsEnabled($event)" />
    <div v-if="store.achievements" class="achievement-grid">
      <article
        v-for="achievement in store.achievements.achievements"
        :key="`${achievement.id}:${achievement.version}`"
        class="achievement-tile"
        :class="{ unlocked: achievement.unlocked }"
        :aria-label="`${achievementText(achievement.titleKey)} · ${achievement.unlocked ? t('achievementUnlocked') : t('achievementLocked')}`"
      >
        <span class="achievement-icon" :class="{ unlocked: achievement.unlocked }"><Icon :name="achievement.unlocked ? 'trophy' : 'lock'" :size="15" /></span>
        <span class="achievement-copy">
          <strong>{{ achievementText(achievement.titleKey) }}</strong>
          <span>{{ achievementText(achievement.descriptionKey) }}</span>
          <small v-if="achievement.tokenQuality !== 'none'">{{ t('achievementTokenQuality', { quality: achievementQualityLabel(achievement.tokenQuality) }) }}</small>
        </span>
        <span class="achievement-state">{{ achievement.unlocked ? t('achievementUnlocked') : t('achievementLocked') }}</span>
      </article>
    </div>
    <div v-else class="growth-unavailable" role="status">{{ t('achievementGalleryEmpty') }}</div>
  </Card>
</template>
