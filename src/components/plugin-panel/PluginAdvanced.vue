<script setup lang="ts">
import { t } from '@/i18n'
import Card from '@/components/ui/Card.vue'
import NumberField from '@/components/ui/NumberField.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  snapshot, busy, loading, resourceFields, updateGlobalPreferences, updateResourceLimit,
  resourceInputValue, resourceBoundText,
} = usePluginController()
</script>

<template>
  <Card :title="t('pluginAdvancedSettings')" class="advanced">
    <p class="help">{{ t('pluginAdvancedSettingsHelp') }}</p>
    <ToggleRow
      :model-value="snapshot?.preferences.developerMode ?? false"
      :label="t('pluginDeveloperMode')"
      :help="t('pluginDeveloperModeHelp')"
      :disabled="busy || loading"
      @update:model-value="updateGlobalPreferences({ developerMode: $event })"
    />
    <div class="resource-grid">
      <NumberField
        v-for="field in resourceFields"
        :key="field.key"
        :model-value="Number(resourceInputValue(field.key, snapshot?.preferences.resources[field.key] ?? field.defaultValue))"
        :label="t(field.label)"
        :min="Number(resourceInputValue(field.key, field.min))"
        :max="Number(resourceInputValue(field.key, field.max))"
        :disabled="busy || loading"
        :help="t('pluginResourceRange', {
          default: resourceBoundText(field.key, field.defaultValue),
          min: resourceBoundText(field.key, field.min),
          max: resourceBoundText(field.key, field.max),
        })"
        @commit="updateResourceLimit(field.key, String($event))"
      />
    </div>
  </Card>
</template>

<style scoped>
.help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.5;
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
}
</style>
