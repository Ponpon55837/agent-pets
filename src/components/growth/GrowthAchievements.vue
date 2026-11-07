<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { locale, t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import type { AchievementTokenQuality, AchievementTranslationKey } from '@/types/achievement'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const achievementQualityLabels: Partial<Record<AchievementTokenQuality, Parameters<typeof t>[0]>> = {
  exact: 'achievementTokenExact', estimated: 'achievementTokenEstimated',
}

// Unlocks newer than the last time this view was opened are marked "New".
// Per-viewer convenience only, so storage failures are simply ignored.
const SEEN_KEY = 'agent-pet-achievements-seen-at'
let seenAt = 0
try { seenAt = Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { seenAt = 0 }

function isNew(unlockedAt?: number): boolean {
  return unlockedAt !== undefined && unlockedAt > seenAt
}

function unlockedDate(unlockedAt?: number): string {
  return unlockedAt === undefined
    ? ''
    : t('growth.unlockedOn', { date: new Date(unlockedAt).toLocaleDateString(locale.value) })
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())) } catch { /* ignore */ }
}
onBeforeUnmount(markSeen)
onMounted(() => window.addEventListener('pagehide', markSeen))

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
          <strong>{{ achievementText(achievement.titleKey) }}<em v-if="isNew(achievement.unlockedAt)" class="achievement-new">{{ t('growth.badgeNew') }}</em></strong>
          <span>{{ achievementText(achievement.descriptionKey) }}</span>
          <small v-if="achievement.unlocked && achievement.unlockedAt">{{ unlockedDate(achievement.unlockedAt) }}</small>
          <small v-if="achievement.tokenQuality !== 'none'">{{ t('achievementTokenQuality', { quality: achievementQualityLabel(achievement.tokenQuality) }) }}</small>
        </span>
        <span class="achievement-state">{{ achievement.unlocked ? t('achievementUnlocked') : t('achievementLocked') }}</span>
      </article>
    </div>
    <div v-else class="growth-unavailable" role="status">{{ t('achievementGalleryEmpty') }}</div>
  </Card>
</template>

<style scoped>
.achievement-new {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--text-bright);
  font-size: var(--font-xs);
  font-style: normal;
}
</style>
