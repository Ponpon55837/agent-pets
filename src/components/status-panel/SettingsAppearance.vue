<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Card from '@/components/ui/Card.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { THEME_PREFERENCES, setThemePreference, themePreference } from '@/composables/useTheme'

const store = useAgentStore()
const SCALES = [
  { value: 0.6, label: 'panel.sizeSmall' }, { value: 0.8, label: 'panel.sizeMedium' }, { value: 1.0, label: 'panel.sizeLarge' },
  { value: 1.2, label: 'panel.sizeXLarge' }, { value: 1.5, label: 'panel.sizeXXLarge' },
] as const
const scaleOptions = computed(() => SCALES.map(scale => ({
  value: String(scale.value),
  label: t(scale.label),
  title: `${Math.round(scale.value * 100)}%`,
})))
// Pick the closest preset when the stored scale is a custom value.
const scaleModel = computed({
  get: () => String(SCALES.reduce((best, scale) => Math.abs(scale.value - store.petScale) < Math.abs(best.value - store.petScale) ? scale : best).value),
  set: value => store.setScale(Number(value)),
})
</script>

<template>
  <Card :title="t('design.theme.title')">
    <p class="theme-help">{{ t('design.theme.help') }}</p>
    <Select :model-value="themePreference" :aria-label="t('design.theme.title')" @update:model-value="setThemePreference($event)">
      <option v-for="option in THEME_PREFERENCES" :key="option" :value="option">{{ t(`design.theme.${option}`) }}</option>
    </Select>
  </Card>

  <Card :title="t('petSize')">
    <SegmentedControl v-model="scaleModel" :options="scaleOptions" :ariaLabel="t('petSize')" semantics="radio" id-prefix="pet-size-" size="sm" fill />
    <p class="section-copy">{{ t('panel.sizeHelp', { percent: Math.round(store.petScale * 100) }) }}</p>
  </Card>

  <Card :title="t('petReactions')">
    <ToggleRow :model-value="store.reactionsEnabled" :label="t('bounceShake')" :help="t('animateStatus')" @update:model-value="store.setReactionsEnabled($event)" />
    <ToggleRow :model-value="store.bubbleEnabled" :label="t('statusBubble')" :help="t('showCompletionError')" @update:model-value="store.setBubbleEnabled($event)" />
  </Card>
</template>

<style scoped>
.theme-help {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}
</style>
