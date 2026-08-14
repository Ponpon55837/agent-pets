<script setup lang="ts">
// The settings pages carried 22 copies of the same ten-line block: a <label>
// wrapping a title, a help line, and a three-element switch. This collapses
// each of them to a single tag.
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
  <label class="toggle-row" :class="{ disabled }">
    <span class="copy">
      <span class="label">{{ label }}</span>
      <span v-if="help" class="help">{{ help }}</span>
    </span>
    <span class="switch">
      <input v-model="model" type="checkbox" :disabled="disabled" />
      <span class="track"><span class="thumb" /></span>
    </span>
  </label>
</template>

<style scoped>
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) 0;
  cursor: pointer;
}

.toggle-row.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.label {
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.help {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.switch {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

.switch input {
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.track {
  display: inline-flex;
  align-items: center;
  width: 34px;
  height: 20px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.thumb {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-pill);
  background: var(--text-secondary);
  transition: transform var(--transition-fast), background var(--transition-fast);
}

.switch input:checked + .track {
  border-color: var(--border-accent-strong);
  background: var(--accent-soft);
}

.switch input:checked + .track .thumb {
  transform: translateX(14px);
  background: var(--accent-bright);
}

.switch input:focus-visible + .track {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
</style>
