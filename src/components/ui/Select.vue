<script setup lang="ts">
// The one dropdown in the app. Replaces two divergent implementations:
// .language-select (which never set appearance:none, so it rendered the OS
// arrow — a grey button on Windows, blue chevrons on macOS — and opened a
// white-on-black option list) and .family-pet-select (custom arrow, dark
// options, but a different radius and a sub-11px font).
//
// This stays a native <select> on purpose. A hand-rolled listbox would gain
// full control of the popup, but in a transparent frameless Electron window
// the popup has to be drawn inside the page, where it gets clipped by the
// panel's `overflow: hidden` and loses the OS keyboard/typeahead behaviour.
// The popup itself is painted by the OS and cannot be fully styled — we set
// an opaque background on <option> so neither platform falls back to its own
// light palette, and take full control of the closed (collapsed) state, which
// is what the user actually looks at.
withDefaults(defineProps<{
  size?: 'sm' | 'md'
  ariaLabel?: string
  disabled?: boolean
}>(), {
  size: 'md',
  disabled: false,
})

const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="select-wrap" :class="[`size-${size}`, { disabled }]">
    <select
      v-model="model"
      class="select"
      :aria-label="ariaLabel"
      :disabled="disabled"
    >
      <slot />
    </select>
    <span class="select-chevron" aria-hidden="true">
      <svg viewBox="0 0 10 6" width="10" height="6">
        <path d="m1 1 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  </div>
</template>

<style scoped>
.select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.select {
  width: 100%;
  min-width: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.size-md .select {
  padding: 7px 28px 7px 10px;
  font-size: var(--font-sm);
}

.size-sm .select {
  padding: 5px 26px 5px 9px;
  font-size: var(--font-xs);
}

.select:hover:not(:disabled) {
  border-color: var(--border-accent-strong);
  background: var(--surface-raised-hover);
}

.select:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--focus-ring-width) var(--accent-glow);
}

.select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* Painted by the OS. Only background/color reliably apply, and only when
   opaque — a translucent value makes Windows fall back to system colours. */
.select :deep(option) {
  background: var(--surface-option);
  color: var(--text-on-option);
}

.select-chevron {
  position: absolute;
  right: 9px;
  display: inline-flex;
  color: var(--accent);
  pointer-events: none;
  transition: color var(--transition-fast);
}

.select-wrap:hover:not(.disabled) .select-chevron {
  color: var(--accent-bright);
}

.disabled .select-chevron {
  opacity: 0.55;
}
</style>
