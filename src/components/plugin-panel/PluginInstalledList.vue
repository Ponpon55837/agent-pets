<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  busy,
  loading,
  plugins,
  petOptions,
  catalogItems,
  catalogCheckComplete,
  enabledGlobally,
  selectedPlugin,
  invokingCommandId,
  pluginSettings,
  settingsDraft,
  secretDrafts,
  pluginName,
  pluginIconUrl,
  hidePluginIcon,
  displayFingerprint,
  pluginStatusLabel,
  pluginStatusTone,
  openPluginPanelView,
  commandTitle,
  invokePluginCommand,
  settingTitle,
  settingValue,
  updateSetting,
  savePluginSettings,
  savePluginSecret,
  updatePluginPreference,
  updatePluginRate,
  updatePluginTarget,
  revokeGrantedHost,
  requestRemove,
  reportPluginIssue,
} = usePluginController()
</script>

<template>
  <section class="plugin-section">
    <div class="plugin-section-heading">
      <div>
        <h3>{{ t('pluginInstalledHeading') }}</h3>
        <p>{{ t('pluginInstalledHelp') }}</p>
      </div>
      <span class="plugin-count" aria-live="polite">{{ plugins.length }}</span>
    </div>
    <div v-if="loading && plugins.length === 0" class="plugin-empty">{{ t('checking') }}</div>
    <div v-else-if="plugins.length === 0" class="plugin-empty">{{ t('pluginNoInstalled') }}</div>
    <div v-else class="plugin-list" role="list" :aria-label="t('pluginInstalledHeading')">
      <Card v-for="plugin in plugins" :key="plugin.id" class="plugin-card" role="listitem" :tone="pluginStatusTone(plugin)">
        <div class="plugin-row">
          <img v-if="pluginIconUrl(plugin)" class="plugin-icon" :src="pluginIconUrl(plugin) ?? ''" alt="" @error="hidePluginIcon(plugin.id)" />
          <div v-else class="plugin-icon plugin-icon-placeholder" aria-hidden="true">◇</div>
          <div class="plugin-copy">
            <strong :title="pluginName(plugin)">{{ pluginName(plugin) }}</strong>
            <span>{{ plugin.id }} · {{ t('pluginVersion', { version: plugin.currentVersion }) }}</span>
            <span v-if="catalogCheckComplete && !catalogItems.some(item => item.plugin.id === plugin.id)" class="plugin-development-badge">
              {{ t('pluginCatalogNotOnline') }}
            </span>
            <span v-if="plugin.development || plugin.signatureStatus === 'unverified'" class="plugin-development-badge">{{ t('pluginSignatureDeveloperUnverified') }}</span>
            <span v-else class="plugin-signature-status">
              {{ t(plugin.signatureStatus === 'valid' ? 'pluginSignatureVerified' : 'pluginSignatureUnsigned') }}
            </span>
            <span v-if="!plugin.development && plugin.signatureFingerprint" class="plugin-signature-fingerprint">
              {{ t('pluginSignatureFingerprint', { fingerprint: displayFingerprint(plugin.signatureFingerprint) }) }}
            </span>
          </div>
          <span class="plugin-status" :class="`tone-${pluginStatusTone(plugin)}`">{{ pluginStatusLabel(plugin) }}</span>
        </div>
        <div class="plugin-controls">
          <ToggleRow
            :model-value="plugin.preference.enabled"
            :label="t('pluginEnabled')"
            :disabled="busy || !plugin.manifest || plugin.status === 'incompatible'"
            @update:model-value="updatePluginPreference(plugin.id, { enabled: $event })"
          />
          <ToggleRow
            :model-value="plugin.preference.muted"
            :label="t('pluginMuted')"
            :disabled="busy || !plugin.manifest"
            @update:model-value="updatePluginPreference(plugin.id, { muted: $event })"
          />
          <label class="plugin-preference-field">
            <span>{{ t('pluginPerPluginRateLabel') }}</span>
            <input
              type="number"
              min="1"
              max="30"
              step="1"
              :value="String(plugin.preference.rateLimitPer10Min)"
              :disabled="busy || !plugin.manifest"
              @change="updatePluginRate(plugin.id, ($event.target as HTMLInputElement).value)"
            />
            <small>{{ t('pluginPerPluginRateHelp') }}</small>
          </label>
          <label class="plugin-preference-field">
            <span>{{ t('pluginTargetPetLabel') }}</span>
            <select
              :value="plugin.preference.targetPetId ?? ''"
              :disabled="busy || !plugin.manifest"
              @change="updatePluginTarget(plugin.id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('pluginPrimaryPet') }}</option>
              <option v-for="pet in petOptions" :key="pet.id" :value="pet.id">{{ pet.displayName }}</option>
            </select>
          </label>
          <Button variant="danger" size="sm" :disabled="busy" @click="requestRemove(plugin)">
            {{ t('remove') }}
          </Button>
          <Button variant="secondary" size="sm" :disabled="busy" @click="reportPluginIssue(plugin.id)">
            {{ t('pluginReportIssue') }}
          </Button>
          <Button
            v-if="plugin.manifest?.contributes.panelView"
            variant="secondary"
            size="sm"
            :disabled="busy || !plugin.preference.enabled || !enabledGlobally"
            @click="openPluginPanelView(plugin.id)"
          >
            {{ t('pluginOpenPanel') }}
          </Button>
        </div>
        <div class="plugin-granted-hosts">
          <strong>{{ t('pluginManifestHostsHeading') }}</strong>
          <p v-if="(plugin.manifest?.permissions.network?.hosts ?? []).length === 0" class="plugin-empty compact">{{ t('pluginGrantedHostsEmpty') }}</p>
          <ul v-else>
            <li v-for="host in plugin.manifest?.permissions.network?.hosts ?? []" :key="host"><code>{{ host }}</code></li>
          </ul>
          <strong>{{ t('pluginGrantedHostsHeading') }}</strong>
          <p v-if="plugin.preference.grantedHosts.length === 0" class="plugin-empty compact">{{ t('pluginGrantedHostsEmpty') }}</p>
          <ul v-else>
            <li v-for="host in plugin.preference.grantedHosts" :key="host">
              <code>{{ host }}</code>
              <Button variant="ghost" size="sm" :disabled="busy" @click="revokeGrantedHost(plugin, host)">
                {{ t('pluginRevokeHost') }}
              </Button>
            </li>
          </ul>
        </div>
      </Card>
    </div>
  </section>

  <Card v-if="selectedPlugin?.manifest?.contributes.commands?.length" :title="t('pluginCommandsHeading')" class="plugin-section">
    <p class="plugin-limit-help">{{ t('pluginCommandsHelp') }}</p>
    <div class="plugin-command-list">
      <Button
        v-for="command in selectedPlugin.manifest.contributes.commands"
        :key="command.id"
        variant="secondary"
        size="sm"
        :disabled="Boolean(invokingCommandId) || !selectedPlugin.preference.enabled || !enabledGlobally"
        @click="invokePluginCommand(command.id)"
      >
        {{ commandTitle(command) }}
      </Button>
    </div>
  </Card>

  <Card v-if="selectedPlugin?.manifest?.contributes.settings" :title="t('pluginSettingsHeading')" class="plugin-section">
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
        <select
          v-else-if="definition.enum"
          :id="`plugin-setting-${key}`"
          :value="settingValue(key, definition)"
          :disabled="busy || loading"
          @change="updateSetting(key, definition.type, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="option in definition.enum" :key="String(option)" :value="String(option)">{{ option }}</option>
        </select>
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
  </Card>
</template>

<style scoped src="./plugin-panel-shared.css"></style>
