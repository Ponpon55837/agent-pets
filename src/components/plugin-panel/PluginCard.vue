<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import Icon from '@/components/ui/Icon.vue'
import ActionMenu from '@/components/ui/ActionMenu.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import { usePluginController } from '@/composables/plugin/context'
import type { PluginPanelPlugin } from '@/types/plugin'

const props = defineProps<{ plugin: PluginPanelPlugin }>()

const {
  busy, enabledGlobally, pluginName, pluginIconUrl, hidePluginIcon, pluginStatusLabel, pluginStatusTone,
  openPluginDetail, openPluginPanelView, updatePluginPreference, requestRemove, reportPluginIssue,
} = usePluginController()

const name = computed(() => pluginName(props.plugin))
const tone = computed(() => pluginStatusTone(props.plugin))
const hasSettings = computed(() => Boolean(props.plugin.manifest?.contributes.settings))
const hasPanel = computed(() => Boolean(props.plugin.manifest?.contributes.panelView))
const needsAttention = computed(() => tone.value === 'warn')
const menuItems = computed(() => [
  { id: 'detail', label: t('plugins.menuDetails') },
  { id: 'report', label: t('pluginReportIssue') },
  { id: 'remove', label: t('remove'), danger: true },
])

function onMenu(id: string): void {
  if (id === 'detail') openPluginDetail(props.plugin.id)
  else if (id === 'report') void reportPluginIssue(props.plugin.id)
  else if (id === 'remove') requestRemove(props.plugin)
}
</script>

<template>
  <li class="plugin-card" :class="{ attention: needsAttention }" :aria-label="name">
    <div class="card-head">
      <img v-if="pluginIconUrl(plugin)" class="card-icon" :src="pluginIconUrl(plugin) ?? ''" alt="" @error="hidePluginIcon(plugin.id)" />
      <span v-else class="card-icon card-icon-placeholder" aria-hidden="true"><Icon name="plugin-box" :size="18" /></span>
      <div class="card-copy">
        <strong class="card-name" :title="name">{{ name }}</strong>
        <span class="card-meta">
          {{ t('pluginVersion', { version: plugin.currentVersion }) }}
          <template v-if="plugin.manifest?.author"> · {{ plugin.manifest.author }}</template>
        </span>
      </div>
      <Chip :tone="tone === 'success' ? 'success' : tone === 'warn' ? 'warn' : 'neutral'" :icon="tone === 'success' ? 'check' : tone === 'warn' ? 'warning' : undefined">
        {{ pluginStatusLabel(plugin) }}
      </Chip>
    </div>
    <div class="card-actions">
      <Button
        v-if="hasPanel"
        variant="primary"
        size="sm"
        :disabled="busy || !plugin.preference.enabled || !enabledGlobally"
        :aria-label="t('plugins.openPanelNamed', { name })"
        @click="openPluginPanelView(plugin.id)"
      >
        {{ t('pluginOpenPanel') }}
      </Button>
      <Button
        v-if="hasSettings"
        variant="secondary"
        size="sm"
        :aria-label="t('plugins.settingsNamed', { name })"
        @click="openPluginDetail(plugin.id, 'settings')"
      >
        {{ t('plugins.settings') }}
      </Button>
      <Button variant="ghost" size="sm" :aria-label="t('plugins.detailsNamed', { name })" @click="openPluginDetail(plugin.id)">
        {{ t('plugins.details') }}
        <Icon name="chevron-right" :size="14" />
      </Button>
      <span class="card-spacer" />
      <ToggleRow
        class="card-toggle"
        :model-value="plugin.preference.enabled"
        :label="t('pluginEnabled')"
        :aria-label="t('plugins.enableNamed', { name })"
        :disabled="busy || !plugin.manifest || plugin.status === 'incompatible'"
        @update:model-value="updatePluginPreference(plugin.id, { enabled: $event })"
      />
      <ActionMenu
        :items="menuItems"
        :aria-label="t('plugins.moreNamed', { name })"
        icon-only
        variant="ghost"
        :disabled="busy"
        @select="onMenu"
      >
        <Icon name="more" :size="18" />
      </ActionMenu>
    </div>
  </li>
</template>

<style scoped>
.plugin-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: var(--shadow-raised);
  list-style: none;
}

.plugin-card.attention {
  box-shadow: inset 0 0 0 1px var(--state-warn);
}

.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.card-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-muted);
  object-fit: contain;
}

.card-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.card-name {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.card-spacer {
  flex: 1 1 auto;
}

.card-toggle {
  flex: 0 0 auto;
  gap: var(--space-2);
}

.card-toggle :deep(.label) {
  font-size: var(--font-sm);
}
</style>
