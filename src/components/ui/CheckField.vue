<script setup lang="ts">
// A labelled checkbox for confirmations and form booleans. On/off settings that
// take effect immediately should use ToggleRow instead.
withDefaults(defineProps<{
  label: string
  help?: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label class="check" :class="{ disabled }">
    <input v-model="model" class="check-input" type="checkbox" :disabled="disabled" />
    <span class="check-copy">
      <span class="check-label">{{ label }}</span>
      <span v-if="help" class="check-help">{{ help }}</span>
    </span>
  </label>
</template>

<style scoped>
.check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  cursor: pointer;
}

.check.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.check-input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin: 1px 0 0;
  accent-color: var(--accent);
}

.check-input:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.check-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.check-label {
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.check-help {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}
</style>
