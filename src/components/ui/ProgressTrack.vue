<script setup lang="ts">
// One progress bar. Replaces .quota-track, .mood-bar, .progression-bar,
// .history-progress-track, .history-day-track and .history-agent-track —
// six implementations of "rounded track plus percentage fill", each with its
// own height and gradient.
const props = withDefaults(defineProps<{
  value: number
  tone?: 'accent' | 'success' | 'warn' | 'error' | 'claude'
  ariaLabel?: string
  decorative?: boolean
}>(), {
  tone: 'accent',
  decorative: false,
})

const clamped = () => Math.max(0, Math.min(100, props.value))
</script>

<template>
  <div
    class="track"
    :class="`tone-${tone}`"
    :role="decorative ? undefined : 'progressbar'"
    :aria-label="decorative ? undefined : ariaLabel"
    :aria-valuemin="decorative ? undefined : 0"
    :aria-valuemax="decorative ? undefined : 100"
    :aria-valuenow="decorative ? undefined : clamped()"
  >
    <div class="fill" :style="{ width: `${clamped()}%` }" />
  </div>
</template>

<style scoped>
.track {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface-raised-hover);
}

.fill {
  height: 100%;
  border-radius: inherit;
  transition: width var(--transition-slow);
}

.tone-accent .fill {
  background: var(--gradient-accent);
}

.tone-claude .fill {
  background: var(--gradient-claude);
}

.tone-success .fill {
  background: var(--state-success);
}

.tone-warn .fill {
  background: var(--state-warn-bright);
}

.tone-error .fill {
  background: var(--state-error);
}
</style>
