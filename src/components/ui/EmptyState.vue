<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'

// One treatment for "nothing here", "loading" and "failed" so every panel view
// reports them the same way (role=status / alert, aria-busy while loading) and
// can offer a recovery action in the default slot.
withDefaults(defineProps<{
  kind?: 'empty' | 'loading' | 'error'
  title: string
  description?: string
  icon?: string
}>(), {
  kind: 'empty',
})
</script>

<template>
  <div
    class="empty-state"
    :class="`kind-${kind}`"
    :role="kind === 'error' ? 'alert' : 'status'"
    :aria-live="kind === 'error' ? 'assertive' : 'polite'"
    :aria-busy="kind === 'loading' ? true : undefined"
  >
    <Icon v-if="icon || kind === 'error'" class="empty-state-icon" :name="icon ?? 'warning'" :size="22" />
    <span v-else-if="kind === 'loading'" class="empty-state-spinner" aria-hidden="true" />
    <strong class="empty-state-title">{{ title }}</strong>
    <span v-if="description" class="empty-state-description">{{ description }}</span>
    <div v-if="$slots.default" class="empty-state-actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-3);
  color: var(--text-muted);
  font-size: var(--font-body-sm, var(--font-sm));
  line-height: 1.5;
  text-align: center;
}

.empty-state-title {
  color: var(--text-secondary);
  font-size: var(--font-body-md, var(--font-sm));
  font-weight: var(--weight-medium);
}

.kind-error .empty-state-icon,
.kind-error .empty-state-title {
  color: var(--accent-text, var(--state-error));
}

.empty-state-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.empty-state-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: var(--radius-pill);
  animation: empty-state-spin 0.9s linear infinite;
}

@keyframes empty-state-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .empty-state-spinner {
    animation: none;
    border-top-color: var(--border-strong);
  }
}
</style>
