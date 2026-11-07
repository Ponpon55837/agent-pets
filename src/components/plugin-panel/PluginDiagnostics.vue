<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import { usePluginController } from '@/composables/plugin/context'

const { logs, diagnostics, selectedPluginId, refreshDiagnostics, diagnosticTime, diagnosticCodeLabel } = usePluginController()
</script>

<template>
  <section class="diagnostics" :aria-label="t('pluginDiagnosticsHeading')">
    <p class="help">{{ t('pluginDiagnosticsHelp') }}</p>
    <h4 class="subheading">{{ t('pluginRecentLogs') }}</h4>
    <p v-if="logs.length === 0" class="empty">{{ t('pluginNoLogs') }}</p>
    <ul v-else class="entries">
      <li v-for="(entry, index) in logs" :key="`${entry.at}-${index}`">
        <time>{{ diagnosticTime(entry.at) }}</time>
        <span class="level" :class="`level-${entry.level}`">{{ entry.level }}</span>
        <span class="message">{{ entry.message }}</span>
      </li>
    </ul>
    <h4 class="subheading">{{ t('pluginRejectedCalls') }}</h4>
    <p v-if="diagnostics.length === 0" class="empty">{{ t('pluginNoDiagnostics') }}</p>
    <ul v-else class="entries">
      <li v-for="(entry, index) in diagnostics" :key="`${entry.at}-${index}`">
        <time>{{ diagnosticTime(entry.at) }}</time>
        <span class="message">{{ diagnosticCodeLabel(entry) }}</span>
      </li>
    </ul>
    <div class="actions">
      <Button variant="secondary" size="sm" @click="refreshDiagnostics(selectedPluginId)">{{ t('refresh') }}</Button>
    </div>
  </section>
</template>

<style scoped>
.diagnostics {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.help,
.empty {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.5;
}

.subheading {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.entries {
  max-height: 180px;
  margin: 0;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  list-style: none;
}

.entries li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-xs);
}

.entries li:last-child {
  border-bottom: 0;
}

time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.level {
  flex: 0 0 auto;
  text-transform: uppercase;
}

.level-error {
  color: var(--state-error-soft);
}

.level-warn {
  color: var(--state-warn-bright);
}

.message {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
</style>
