<script setup lang="ts">
import { locale, t } from '@/i18n'
import { shouldShowCatalogPermissionCheck } from '@/types/plugin-catalog'
import { DEFAULT_PLUGIN_CATALOG_URL } from '@/types/plugin-catalog'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  snapshot,
  busy,
  loading,
  catalogItems,
  catalogSearch,
  catalogUrlDraft,
  onlineCatalogEnabled,
  dailyUpdateCheck,
  filteredCatalogItems,
  displayFingerprint,
  restoreCatalogUrl,
  saveCatalogUrl,
  loadPluginCatalog,
  installCatalogPlugin,
  updateGlobalPreferences,
} = usePluginController()
</script>

<template>
  <Card :title="t('pluginCatalogHeading')" class="plugin-section">
    <ToggleRow
      :model-value="onlineCatalogEnabled"
      :label="t('pluginCatalogEnabled')"
      :help="t('pluginCatalogEnabledHelp')"
      :disabled="busy || loading"
      @update:model-value="updateGlobalPreferences({ onlineCatalogEnabled: $event })"
    />
    <template v-if="onlineCatalogEnabled">
      <div class="plugin-catalog-controls">
        <label class="plugin-preference-field">
          <span>{{ t('pluginCatalogUrlLabel') }}</span>
          <input v-model="catalogUrlDraft" type="url" maxlength="2048" autocomplete="url" :disabled="busy || loading" />
          <small>{{ t('pluginCatalogUrlHelp') }}</small>
        </label>
        <div class="plugin-toolbar-actions">
          <Button variant="secondary" size="sm" :disabled="busy || loading" @click="saveCatalogUrl">
            {{ t('pluginCatalogSaveUrl') }}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy || loading || snapshot?.preferences.catalogUrl === DEFAULT_PLUGIN_CATALOG_URL"
            @click="restoreCatalogUrl"
          >
            {{ t('pluginCatalogRestoreDefault') }}
          </Button>
          <Button variant="primary" size="sm" :disabled="busy || loading || !snapshot?.preferences.catalogUrl" @click="loadPluginCatalog">
            {{ t('pluginCatalogLoad') }}
          </Button>
        </div>
      </div>
      <ToggleRow
        :model-value="dailyUpdateCheck"
        :label="t('pluginCatalogDailyCheck')"
        :help="t('pluginCatalogDailyCheckHelp')"
        :disabled="busy || loading || !snapshot?.preferences.catalogUrl"
        @update:model-value="updateGlobalPreferences({ dailyUpdateCheck: $event })"
      />
      <label v-if="catalogItems.length" class="plugin-preference-field">
        <span>{{ t('pluginCatalogSearchLabel') }}</span>
        <input v-model="catalogSearch" type="search" :placeholder="t('pluginCatalogSearchPlaceholder')" />
      </label>
      <div v-if="catalogItems.length === 0" class="plugin-empty">{{ t('pluginCatalogEmpty') }}</div>
      <div v-else-if="filteredCatalogItems.length === 0" class="plugin-empty">{{ t('pluginCatalogNoMatches') }}</div>
      <div v-else class="plugin-list" role="list" :aria-label="t('pluginCatalogHeading')">
        <Card v-for="item in filteredCatalogItems" :key="item.plugin.id" class="plugin-card" role="listitem">
          <div class="plugin-row">
            <div class="plugin-copy">
              <strong :title="item.plugin.name[locale]">{{ item.plugin.name[locale] }}</strong>
              <span>{{ item.plugin.id }} · {{ t('pluginCatalogAuthor', { author: item.plugin.author }) }}</span>
              <span>{{ item.plugin.description[locale] }}</span>
              <span>{{ t('pluginVersion', { version: item.latestVersion.version }) }}</span>
              <span v-if="item.plugin.publicKeyFingerprint" class="plugin-signature-fingerprint">
                {{ t('pluginCatalogSignaturePinned', { fingerprint: displayFingerprint(item.plugin.publicKeyFingerprint) }) }}
              </span>
              <span v-else>{{ t('pluginCatalogSignatureUnpinned') }}</span>
              <span v-if="item.installedVersion">
                {{ t('pluginCatalogInstalledVersion', { version: item.installedVersion }) }}
              </span>
              <span v-if="shouldShowCatalogPermissionCheck(item.permissionsIncreased, item.updateAvailable)">
                {{ t('pluginCatalogPermissionsCheckOnUpdate') }}
              </span>
              <span v-if="item.updateAvailable && item.signingKeyChange === 'changed'" class="plugin-development-badge">
                {{ t('pluginCatalogSigningKeyChanged') }}
              </span>
              <span v-else-if="item.updateAvailable && item.signingKeyChange === 'unchanged'">
                {{ t('pluginCatalogSigningKeyUnchanged') }}
              </span>
              <span v-else-if="item.updateAvailable">
                {{ t('pluginCatalogSigningKeyCheckOnUpdate') }}
              </span>
              <span v-if="item.catalogOlder" class="plugin-development-badge">
                {{ t('pluginCatalogOlderThanInstalled') }}
              </span>
            </div>
            <Button variant="secondary" size="sm"
              :disabled="busy || (item.installedVersion !== null && !item.updateAvailable)"
              @click="installCatalogPlugin(item)">
              {{ t(!item.installedVersion ? 'pluginCatalogInstall' : item.updateAvailable ? 'pluginCatalogUpdate' : 'pluginCatalogUpToDate') }}
            </Button>
          </div>
        </Card>
      </div>
    </template>
  </Card>
</template>

<style scoped src="./plugin-panel-shared.css"></style>
