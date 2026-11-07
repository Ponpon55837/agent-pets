<script setup lang="ts">
// Placeholder block shown while data loads. Decorative: pair it with a
// container that sets aria-busy and an accessible status message.
withDefaults(defineProps<{ width?: string; height?: string; lines?: number }>(), {
  width: '100%',
  height: '12px',
  lines: 1,
})
</script>

<template>
  <span class="skeleton-group" aria-hidden="true">
    <span v-for="line in lines" :key="line" class="skeleton" :style="{ width: line === lines && lines > 1 ? '60%' : width, height }" />
  </span>
</template>

<style scoped>
.skeleton-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.skeleton {
  display: block;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
