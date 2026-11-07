<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Select from '@/components/ui/Select.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  busy, loading, selectedPlugin, pluginSettings, settingsDraft, secretDrafts,
  settingTitle, settingValue, updateSetting, savePluginSettings, savePluginSecret,
} = usePluginController()
</script>

<template>
  <div v-if="selectedPlugin?.manifest?.contributes.settings" class="settings-form">
    <div v-for="(definition, key) in selectedPlugin.manifest.contributes.settings.properties" :key="key" class="plugin-setting-field">
      <template v-if="definition.format === 'secret'">
        <span class="plugin-setting-label">{{ settingTitle(definition.title, key) }}</span>
        <p class="plugin-secret-state">
          {{ pluginSettings?.secrets[key] ? t('pluginSecretConfigured') : t('pluginSecretNotConfigured') }}
        </p>
        <div class="plugin-secret-control">
          <input
            v-model="secretDrafts[key]"
            type="password"
            autocomplete="new-password"
            :maxlength="definition.maxLength ?? 4096"
            :aria-label="settingTitle(definition.title, key)"
            :disabled="busy || loading"
          />
          <Button variant="secondary" size="sm" :disabled="busy || loading" @click="savePluginSecret(key)">
            {{ t('pluginSecretSave') }}
          </Button>
        </div>
      </template>
      <template v-else>
        <label :for="`plugin-setting-${key}`" class="plugin-setting-label">{{ settingTitle(definition.title, key) }}</label>
        <input
          v-if="definition.type === 'boolean'"
          :id="`plugin-setting-${key}`"
          type="checkbox"
          :checked="Boolean(settingsDraft[key] ?? definition.default ?? false)"
          :disabled="busy || loading"
          @change="updateSetting(key, 'boolean', ($event.target as HTMLInputElement).checked)"
        />
        <Select
          v-else-if="definition.enum"
          :model-value="settingValue(key, definition)"
          :aria-label="settingTitle(definition.title, key)"
          :disabled="busy || loading"
          @update:model-value="updateSetting(key, definition.type, $event)"
        >
          <option v-for="option in definition.enum" :key="String(option)" :value="String(option)">{{ option }}</option>
        </Select>
        <input
          v-else
          :id="`plugin-setting-${key}`"
          :type="definition.type === 'number' ? 'number' : 'text'"
          :value="settingValue(key, definition)"
          :min="definition.minimum"
          :max="definition.maximum"
          :maxlength="definition.maxLength"
          :disabled="busy || loading"
          @input="updateSetting(key, definition.type, ($event.target as HTMLInputElement).value)"
        />
      </template>
    </div>
    <Button variant="primary" size="sm" :disabled="busy || loading" @click="savePluginSettings">
      {{ t('pluginSettingsSave') }}
    </Button>
  </div>
</template>

<style scoped>
.settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.plugin-setting-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.plugin-setting-label {
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.plugin-setting-field > input:not([type="checkbox"]),
.plugin-secret-control > input {
  width: 100%;
  min-height: 36px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.plugin-setting-field > input[type="checkbox"] {
  align-self: flex-start;
  accent-color: var(--accent);
}

.plugin-secret-state {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.plugin-secret-control {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.plugin-secret-control > input {
  min-width: 0;
  flex: 1 1 auto;
}
</style>
