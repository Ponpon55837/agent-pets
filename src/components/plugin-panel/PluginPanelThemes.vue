<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Chip from '@/components/ui/Chip.vue'
import PanelThemePreview from '@/components/panel-theme/PanelThemePreview.vue'
import PanelThemeImageControls from '@/components/panel-theme/PanelThemeImageControls.vue'
import { panelThemeMedia, panelThemeState, refreshPanelThemeState } from '@/composables/usePanelTheme'
import { usePanelThemeActions } from '@/composables/usePanelThemeActions'
import { activePanelThemeModes } from '@/utils/panel-theme-css'
import { PANEL_THEME_MODES, type PanelThemeCatalogEntry, type PanelThemeMode } from '@/types/panel-theme'

// Plugins -> <plugin> -> Panel themes (spec §8). Lists this plugin's themes with
// light/dark previews and applies one to Light, Dark or Both. There is one slot
// per mode across all plugins, so applying here replaces whatever was active.
// The whole section is .host-protected: it always renders built-in.

const props = defineProps<{ pluginId: string; pluginEnabled: boolean }>()
const { busy, status, error, applyTheme, restoreBuiltIn } = usePanelThemeActions()

const MODE_SHORT: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeShortLight', dark: 'design.panelTheme.modeShortDark' }
const MODE_NAME: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeLight', dark: 'design.panelTheme.modeDark' }

const root = ref<HTMLElement | null>(null)
const visible = ref(false)
let observer: IntersectionObserver | null = null

const themes = computed(() => (panelThemeState.value?.themes ?? []).filter(entry => entry.ref.pluginId === props.pluginId))
const anySlotSet = computed(() => Boolean(panelThemeState.value?.slots.light.ref || panelThemeState.value?.slots.dark.ref))

function modesOf(entry: PanelThemeCatalogEntry): PanelThemeMode[] {
  return PANEL_THEME_MODES.filter(mode => entry.modes[mode])
}

function activeModes(entry: PanelThemeCatalogEntry): PanelThemeMode[] {
  return activePanelThemeModes(panelThemeState.value, entry.ref)
}

function previewLabel(entry: PanelThemeCatalogEntry, mode: PanelThemeMode): string {
  return t('design.panelTheme.preview', { theme: entry.displayName[locale.value], mode: t(MODE_NAME[mode]) })
}

onMounted(() => {
  void refreshPanelThemeState()
  if (typeof IntersectionObserver === 'function' && root.value) {
    observer = new IntersectionObserver(entries => { visible.value = entries.some(entry => entry.isIntersecting) })
    observer.observe(root.value)
  } else {
    visible.value = true
  }
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section ref="root" class="plugin-panel-themes host-protected" data-testid="plugin-panel-themes">
    <p class="themes-help">{{ t('design.panelTheme.help') }}</p>
    <p v-if="panelThemeMedia.forcedColors" class="themes-note" role="status">{{ t('design.panelTheme.suspendedForcedColors') }}</p>
    <p v-if="!pluginEnabled || themes.length === 0" class="themes-note" role="status">{{ t('design.panelTheme.pluginOff') }}</p>

    <article v-for="entry in themes" :key="entry.ref.themeId" class="theme" :data-testid="`panel-theme-${entry.ref.themeId}`">
      <header class="theme-header">
        <div class="theme-title-group">
          <strong class="theme-title">{{ entry.displayName[locale] }}</strong>
          <span v-if="entry.description" class="theme-description">{{ entry.description[locale] }}</span>
        </div>
        <ul class="theme-badges">
          <li v-for="mode in activeModes(entry)" :key="mode">
            <Chip tone="success" icon="check">{{ t('design.panelTheme.activeBadge', { mode: t(MODE_SHORT[mode]) }) }}</Chip>
          </li>
          <li v-if="modesOf(entry).length === 1">
            <Chip tone="neutral">{{ t(modesOf(entry)[0] === 'light' ? 'design.panelTheme.lightOnly' : 'design.panelTheme.darkOnly') }}</Chip>
          </li>
        </ul>
      </header>
      <div v-if="visible" class="theme-previews">
        <PanelThemePreview
          v-for="mode in modesOf(entry)"
          :key="mode"
          :entry="entry"
          :mode="mode"
          :builtin="null"
          :label="previewLabel(entry, mode)"
          :forced-colors="panelThemeMedia.forcedColors"
        />
      </div>
      <div class="theme-actions">
        <Button
          v-for="mode in modesOf(entry)"
          :key="mode"
          size="sm"
          variant="secondary"
          :disabled="busy || activeModes(entry).includes(mode)"
          :data-testid="`panel-theme-use-${entry.ref.themeId}-${mode}`"
          @click="applyTheme(entry.ref, [mode])"
        >
          {{ t(mode === 'light' ? 'design.panelTheme.useLight' : 'design.panelTheme.useDark') }}
        </Button>
        <Button
          v-if="modesOf(entry).length === 2"
          size="sm"
          variant="primary"
          :disabled="busy || activeModes(entry).length === 2"
          :data-testid="`panel-theme-use-${entry.ref.themeId}-both`"
          @click="applyTheme(entry.ref, PANEL_THEME_MODES)"
        >
          {{ t('design.panelTheme.useForBoth') }}
        </Button>
      </div>
      <template v-for="mode in activeModes(entry)" :key="`image-${mode}`">
        <PanelThemeImageControls v-if="entry.modes[mode]?.userImage" :theme-ref="entry.ref" :mode="mode" :user-image="entry.modes[mode]!.userImage!" />
      </template>
    </article>

    <div class="themes-footer">
      <Button size="sm" variant="secondary" :disabled="busy || !anySlotSet" data-testid="panel-theme-restore" @click="restoreBuiltIn">{{ t('design.panelTheme.restoreBuiltIn') }}</Button>
    </div>
    <p class="themes-live" role="status">{{ status }}</p>
    <p v-if="error" class="themes-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.plugin-panel-themes {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.themes-help,
.themes-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.theme-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.theme-title-group {
  display: flex;
  min-width: 0;
  flex: 1 1 12em;
  flex-direction: column;
  gap: 2px;
}

.theme-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-description {
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
}

.theme-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.theme-previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.theme-actions,
.themes-footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.themes-footer {
  justify-content: flex-end;
}

.themes-live {
  min-height: 1em;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.themes-error {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}
</style>
