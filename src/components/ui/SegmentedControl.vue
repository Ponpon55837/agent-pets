<script setup lang="ts">
import { useRovingTabs } from '@/composables/useRovingTabs'
import Icon from '@/components/ui/Icon.vue'

// One pill-shaped selector for both navigation (role=tablist, pairs with a
// tabpanel) and single-choice settings (role=radiogroup). Replaces the dashboard
// tab strip, the settings nav pills and the hand-rolled pet size buttons so
// all three share keyboard handling (arrows, Home/End) and focus styling.
export interface SegmentedOption {
  value: string
  label: string
  icon?: string
  /** Small count shown next to the label; hidden when 0 or undefined. */
  badge?: number
  /** A dot signalling something needs attention. */
  attention?: boolean
  title?: string
}

const props = withDefaults(defineProps<{
  options: readonly SegmentedOption[]
  ariaLabel: string
  /** tabs → role=tablist/tab; radio → role=radiogroup/radio. */
  semantics?: 'tabs' | 'radio'
  /** DOM id prefix for each segment (`${idPrefix}${value}`). */
  idPrefix?: string
  /** For tabs: id prefix of the controlled tabpanel (`${panelIdPrefix}${value}`). */
  panelIdPrefix?: string
  /** For tabs sharing one tabpanel element: its fixed id (overrides panelIdPrefix). */
  panelId?: string
  size?: 'sm' | 'md'
  fill?: boolean
}>(), {
  semantics: 'tabs',
  idPrefix: 'segment-',
  panelIdPrefix: '',
  size: 'md',
  fill: false,
})

const model = defineModel<string>({ required: true })

const { onKeydown } = useRovingTabs({
  ids: () => props.options.map(option => option.value),
  current: () => model.value,
  select: value => { model.value = value },
  elementId: value => `${props.idPrefix}${value}`,
})
</script>

<template>
  <div
    class="segmented"
    :class="[`size-${size}`, { fill }]"
    :role="semantics === 'tabs' ? 'tablist' : 'radiogroup'"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in options"
      :id="`${idPrefix}${option.value}`"
      :key="option.value"
      type="button"
      class="segment"
      :class="{ active: model === option.value }"
      :role="semantics === 'tabs' ? 'tab' : 'radio'"
      :aria-selected="semantics === 'tabs' ? model === option.value : undefined"
      :aria-checked="semantics === 'radio' ? model === option.value : undefined"
      :aria-controls="semantics !== 'tabs' ? undefined : (panelId && model === option.value ? panelId : (!panelId && panelIdPrefix ? `${panelIdPrefix}${option.value}` : undefined))"
      :tabindex="model === option.value ? 0 : -1"
      :title="option.title"
      @click="model = option.value"
      @keydown="onKeydown"
    >
      <Icon v-if="option.icon" :name="option.icon" :size="14" />
      <span class="segment-label">{{ option.label }}</span>
      <span v-if="option.badge" class="segment-badge">{{ option.badge }}</span>
      <span v-if="option.attention" class="segment-dot" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  min-width: 0;
  max-width: 100%;
  gap: var(--space-1);
  padding: var(--space-1);
  overflow-x: auto;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  scrollbar-width: none;
}

.segmented.fill {
  display: flex;
  width: 100%;
}

.segmented::-webkit-scrollbar {
  display: none;
}

.segment {
  position: relative;
  display: inline-flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-heading, var(--font-ui));
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.fill .segment {
  flex: 1 1 0;
}

.size-md .segment {
  padding: 7px var(--space-3);
  font-size: var(--font-body-md, var(--font-sm));
}

.size-sm .segment {
  padding: 5px var(--space-3);
  font-size: var(--font-body-sm, var(--font-xs));
}

.segment:hover:not(.active) {
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.segment.active {
  background: var(--accent);
  color: var(--accent-bright);
}

.segment:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.segment-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.segment-badge {
  min-width: 18px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--font-label, var(--font-xs));
  line-height: 1.4;
}

.active .segment-badge {
  background: var(--accent-bright);
  color: var(--accent);
}

.segment-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--accent-text);
}

.active .segment-dot {
  background: var(--accent-bright);
}
</style>
