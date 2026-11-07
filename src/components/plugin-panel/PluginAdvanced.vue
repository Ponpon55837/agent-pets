<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  snapshot,
  busy,
  loading,
  plugins,
  logs,
  diagnostics,
  selectedPluginId,
  resourceFields,
  pluginName,
  refreshDiagnostics,
  updateGlobalPreferences,
  updateResourceLimit,
  resourceInputValue,
  resourceBoundText,
  diagnosticTime,
  diagnosticCodeLabel,
} = usePluginController()
</script>

<template>
  <Card :title="t('pluginAdvancedSettings')" class="plugin-section">
    <p class="plugin-limit-help">{{ t('pluginAdvancedSettingsHelp') }}</p>
    <ToggleRow
      :model-value="snapshot?.preferences.developerMode ?? false"
      :label="t('pluginDeveloperMode')"
      :help="t('pluginDeveloperModeHelp')"
      :disabled="busy || loading"
      @update:model-value="updateGlobalPreferences({ developerMode: $event })"
    />
    <div class="plugin-resource-grid">
      <label v-for="field in resourceFields" :key="field.key" class="plugin-resource-field">
        <span>{{ t(field.label) }}</span>
        <input
          type="number"
          :value="resourceInputValue(field.key, snapshot?.preferences.resources[field.key] ?? field.defaultValue)"
          :min="resourceInputValue(field.key, field.min)"
          :max="resourceInputValue(field.key, field.max)"
          step="1"
          :disabled="busy || loading"
          @change="updateResourceLimit(field.key, ($event.target as HTMLInputElement).value)"
        />
        <small>{{ t('pluginResourceRange', {
          default: resourceBoundText(field.key, field.defaultValue),
          min: resourceBoundText(field.key, field.min),
          max: resourceBoundText(field.key, field.max),
        }) }}</small>
      </label>
    </div>
  </Card>

  <section class="plugin-section">
    <div class="plugin-section-heading">
      <div>
        <h3>{{ t('pluginDiagnosticsHeading') }}</h3>
        <p>{{ t('pluginDiagnosticsHelp') }}</p>
      </div>
      <Select v-model="selectedPluginId" size="sm" :aria-label="t('pluginDiagnosticsHeading')" :disabled="plugins.length === 0">
        <option v-for="plugin in plugins" :key="plugin.id" :value="plugin.id">{{ pluginName(plugin) }}</option>
      </Select>
    </div>
    <template v-if="selectedPluginId">
      <div class="plugin-subheading">{{ t('pluginRecentLogs') }}</div>
      <div v-if="logs.length === 0" class="plugin-empty compact">{{ t('pluginNoLogs') }}</div>
      <ul v-else class="plugin-diagnostic-list">
        <li v-for="(entry, index) in logs" :key="`${entry.at}-${index}`">
          <time>{{ diagnosticTime(entry.at) }}</time>
          <span class="plugin-log-level" :class="`level-${entry.level}`">{{ entry.level }}</span>
          <span class="plugin-log-message">{{ entry.message }}</span>
        </li>
      </ul>
      <div class="plugin-subheading">{{ t('pluginRejectedCalls') }}</div>
      <div v-if="diagnostics.length === 0" class="plugin-empty compact">{{ t('pluginNoDiagnostics') }}</div>
      <ul v-else class="plugin-diagnostic-list">
        <li v-for="(entry, index) in diagnostics" :key="`${entry.at}-${index}`">
          <time>{{ diagnosticTime(entry.at) }}</time>
          <span class="plugin-log-message">{{ diagnosticCodeLabel(entry) }}</span>
        </li>
      </ul>
      <Button variant="secondary" size="sm" @click="refreshDiagnostics()">{{ t('refresh') }}</Button>
    </template>
    <div v-else class="plugin-empty compact">{{ t('pluginSelectForDiagnostics') }}</div>
  </section>
</template>

<style scoped src="./plugin-panel-shared.css"></style>
