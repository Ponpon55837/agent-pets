<script setup lang="ts">
// Replaces five card treatments (.settings-card, .settings-hero-card,
// .history-card, .usage-provider, .progression-card) that each defined their
// own padding, radius, border and gradient — so moving between Usage and
// History showed two different materials for the same kind of container.
//
// `tone` is deliberately restrained: most cards stay `neutral` (the flat
// content-layer look Liquid Glass asks for — see references/liquid-glass.md).
// Reach for a tone only when the card has a real semantic identity shared
// with other UI using the same colour (session activity is green everywhere,
// token/growth numbers are accent purple everywhere, Claude's own quota card
// keeps Claude's hue) — colouring every card would just be noise again.
withDefaults(defineProps<{
  tone?: 'neutral' | 'accent' | 'success' | 'claude' | 'warn'
  title?: string
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <section class="card" :class="`tone-${tone}`">
    <header v-if="title || $slots.heading" class="card-heading">
      <h3 v-if="title" class="card-title">{{ title }}</h3>
      <slot name="heading" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-3) calc(var(--space-3) + 3px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: var(--shadow-raised);
}

/* A 3px identity bar on the leading edge rather than a tinted fill across
   the whole card — enough to read as "this card is about growth/tokens/
   sessions" at a glance without competing with the content on top of it. */
.card::before {
  content: '';
  position: absolute;
  top: var(--space-2);
  bottom: var(--space-2);
  left: 0;
  width: 3px;
  border-radius: var(--radius-pill);
  background: transparent;
}

.tone-accent {
  border-color: var(--border-accent);
  background: var(--accent-wash);
}

.tone-accent::before {
  background: var(--accent);
}

.tone-success {
  border-color: color-mix(in srgb, var(--state-success) 28%, transparent);
  background: color-mix(in srgb, var(--state-success) 6%, transparent);
}

.tone-success::before {
  background: var(--state-success);
}

.tone-claude {
  border-color: var(--border-claude);
  background: var(--surface-claude);
}

.tone-claude::before {
  background: var(--accent-claude);
}

.tone-warn {
  border-color: color-mix(in srgb, var(--state-warn-bright) 28%, transparent);
  background: color-mix(in srgb, var(--state-warn-bright) 6%, transparent);
}

.tone-warn::before {
  background: var(--state-warn-bright);
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.tone-accent .card-title {
  color: var(--accent-bright);
}

.tone-success .card-title {
  color: var(--state-success);
}

.tone-claude .card-title {
  color: var(--accent-claude);
}

.tone-warn .card-title {
  color: var(--state-warn-bright);
}
</style>
