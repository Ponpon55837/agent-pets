<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

// Fixed-position feedback stack. Errors use role="alert" and stay until
// dismissed; success/info use role="status" and clear themselves. Being fixed
// means a message never moves the layout and is always where the user is
// looking, instead of in the middle of a scrolled page.
export interface ToastItem {
  id: number
  tone: 'success' | 'error' | 'info'
  text: string
  detail?: string
  action?: { label: string }
}

defineProps<{ toasts: ToastItem[] }>()
const emit = defineEmits<{ dismiss: [id: number]; action: [id: number] }>()

const iconByTone = { success: 'check', error: 'warning', info: 'info' } as const
</script>

<template>
  <div class="toast-stack">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="`tone-${toast.tone}`"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
      >
        <Icon :name="iconByTone[toast.tone]" :size="16" class="toast-icon" />
        <div class="toast-copy">
          <span class="toast-text">{{ toast.text }}</span>
          <details v-if="toast.detail" class="toast-detail">
            <summary>{{ t('plugins.technicalDetails') }}</summary>
            <code>{{ toast.detail }}</code>
          </details>
        </div>
        <Button v-if="toast.action" variant="secondary" size="sm" @click="emit('action', toast.id)">
          {{ toast.action.label }}
        </Button>
        <Button variant="ghost" size="sm" icon-only class="toast-close" :aria-label="t('plugins.dismiss')" @click="emit('dismiss', toast.id)">
          <Icon name="close" :size="14" />
        </Button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  right: var(--space-3);
  bottom: var(--space-3);
  left: var(--space-3);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

.toast {
  display: flex;
  width: 100%;
  max-width: 420px;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
  color: var(--text-primary);
  font-size: var(--font-sm);
  pointer-events: auto;
}

.toast-icon {
  flex: 0 0 auto;
}

.tone-success .toast-icon {
  color: var(--state-success);
}

.tone-error {
  border-color: var(--state-error);
}

.tone-error .toast-icon {
  color: var(--state-error-soft);
}

.tone-info .toast-icon {
  color: var(--state-info);
}

.toast-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
}

.toast-text {
  overflow-wrap: anywhere;
  line-height: 1.4;
}

.toast-detail {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.toast-detail summary {
  cursor: pointer;
}

.toast-detail code {
  overflow-wrap: anywhere;
}

.toast-close {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(var(--space-2));
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}

@media (forced-colors: active) {
  .toast {
    border: 1px solid CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}
</style>
