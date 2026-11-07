<script setup lang="ts">
import { t } from '@/i18n'
import PluginCard from '@/components/plugin-panel/PluginCard.vue'
import { usePluginController } from '@/composables/plugin/context'

const { plugins, loading } = usePluginController()
</script>

<template>
  <section class="plugin-section" :aria-label="t('pluginInstalledHeading')">
    <p class="plugin-limit-help">{{ t('pluginInstalledHelp') }}</p>
    <div v-if="loading && plugins.length === 0" class="plugin-empty">{{ t('checking') }}</div>
    <div v-else-if="plugins.length === 0" class="plugin-empty">{{ t('pluginNoInstalled') }}</div>
    <ul v-else class="plugin-list" :aria-label="t('pluginInstalledHeading')">
      <PluginCard v-for="plugin in plugins" :key="plugin.id" :plugin="plugin" />
    </ul>
  </section>
</template>

<style scoped>
.plugin-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.plugin-limit-help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.5;
}

.plugin-empty {
  padding: var(--space-3);
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-align: center;
}
</style>
