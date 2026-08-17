<script setup lang="ts">
// Replaces twelve hand-rolled button styles (.setup-btn, .import-btn,
// .usage-refresh, .history-action, .clear-offline-btn, .mood-reset-btn,
// .restart-btn, .quit-btn, .header-btn, .pet-edit, .pet-remove, .scale-option)
// that shared no declarations, so identical roles looked different.
//
// Pick the variant by ROLE, not by appearance:
//   primary   — the main action of a section
//   secondary — supporting actions (refresh, reset, export)
//   danger    — destructive or irreversible (quit, remove, clear)
//   ghost     — icon-only chrome (header controls, inline row actions)
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  disabled?: boolean
  active?: boolean
  iconOnly?: boolean
  block?: boolean
}>(), {
  variant: 'secondary',
  size: 'md',
  type: 'button',
  disabled: false,
  active: false,
  iconOnly: false,
  block: false,
})
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`variant-${variant}`, `size-${size}`, { active, 'icon-only': iconOnly, block }]"
    :disabled="disabled"
    :aria-pressed="active ? true : undefined"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  font: inherit;
  font-family: var(--font-heading, var(--font-ui));
  font-weight: var(--weight-medium);
  line-height: 1;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.block {
  width: 100%;
}

.size-md {
  padding: 9px 15px;
  font-size: var(--font-body-md, var(--font-sm));
}

.size-sm {
  padding: 7px 13.2px;
  font-size: var(--font-label, var(--font-xs));
}

.icon-only {
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: var(--radius-pill);
  font-size: var(--font-lg);
}

.btn:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.btn:disabled {
  cursor: default;
  opacity: 0.55;
}

/* ── primary ─────────────────────────────────────────────────────────── */
.variant-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-bright);
}

.variant-primary:hover:not(:disabled) {
  border-color: var(--accent-hover, var(--accent));
  background: var(--accent-hover, var(--accent-strong));
  color: var(--text-bright);
}

/* ── secondary ───────────────────────────────────────────────────────── */
.variant-secondary {
  border-color: var(--border-strong);
  background: transparent;
  color: var(--text-primary);
}

.variant-secondary:hover:not(:disabled) {
  background: var(--surface-raised-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

/* ── danger ──────────────────────────────────────────────────────────── */
.variant-danger {
  border-color: transparent;
  background: transparent;
  color: var(--accent-text, var(--state-error-soft));
}

.variant-danger:hover:not(:disabled) {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent-text, var(--state-error));
}

/* ── ghost ───────────────────────────────────────────────────────────── */
.variant-ghost {
  color: var(--text-secondary);
}

.variant-ghost:hover:not(:disabled) {
  background: var(--surface-raised-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

/* Selected state for segmented controls (pet size, tabs). */
.btn.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-bright);
}
</style>
