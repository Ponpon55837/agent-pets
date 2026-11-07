<script setup lang="ts">
import { computed, useId } from 'vue'

// Single-line text input with a visible (or screen-reader-only) label, help
// text and an inline error wired through aria-invalid / aria-describedby.
const props = withDefaults(defineProps<{
  label: string
  type?: 'text' | 'url' | 'search' | 'password'
  help?: string
  error?: string
  placeholder?: string
  maxlength?: number
  autocomplete?: string
  disabled?: boolean
  hideLabel?: boolean
}>(), {
  type: 'text',
  disabled: false,
  hideLabel: false,
})

const model = defineModel<string>({ required: true })
const emit = defineEmits<{ enter: [] }>()

const id = useId()
const describedBy = computed(() => [props.help ? `${id}-help` : '', props.error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div class="field">
    <label :for="id" class="field-label" :class="{ 'sr-only': hideLabel }">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      class="field-input"
      :type="type"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :disabled="disabled"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="describedBy"
      @keydown.enter="emit('enter')"
    />
    <small v-if="help" :id="`${id}-help`" class="field-help">{{ help }}</small>
    <small v-if="error" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</small>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.field-label {
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.field-input {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-pill);
  outline: none;
  background: var(--surface-raised-hover);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-sm);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.field-input:hover:not(:disabled) {
  border-color: var(--border-accent-strong);
}

.field-input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--focus-ring-width) var(--accent-glow);
}

.field-input[aria-invalid="true"] {
  border-color: var(--state-error);
}

.field-input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.field-help {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.field-error {
  color: var(--state-error-soft);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
