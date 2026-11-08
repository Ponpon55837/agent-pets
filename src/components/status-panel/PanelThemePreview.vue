<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { PanelThemeCatalogEntry, PanelThemeColorProperty, PanelThemeMode } from '@/types/panel-theme'
import { isPanelThemePropertyValue, panelThemeTargetProperties } from '@/utils/panel-theme-css'
import { validBackdrop, type PanelThemeBackdropView } from '@/composables/usePanelTheme'
import PanelThemeBackdrop from '@/components/PanelThemeBackdrop.vue'

// Static mock of the panel with one theme mode applied inline to a
// .panel-theme-preview element (same validated property map as the panel).
// Built-in previews use the host's built-in palette for that mode.

const props = defineProps<{
  entry: PanelThemeCatalogEntry | null
  mode: PanelThemeMode
  builtin: Record<PanelThemeColorProperty, string> | null
  label: string
  forcedColors: boolean
}>()

const style = computed(() => {
  const result: Record<string, string> = {}
  if (props.forcedColors) return result
  if (props.entry) {
    for (const [name, value] of panelThemeTargetProperties(props.entry, props.mode, { forcedColors: false, highContrast: false }).properties) {
      result[name] = value
    }
  } else if (props.builtin) {
    for (const [name, value] of Object.entries(props.builtin)) {
      if (isPanelThemePropertyValue(name, value)) result[name] = value
    }
  }
  return result
})

const backdrop = computed<PanelThemeBackdropView | null>(() => {
  const modeState = props.entry?.modes[props.mode]
  if (!modeState || props.forcedColors) return null
  const user = modeState.userImage?.current
  if (user) {
    return validBackdrop({ url: user.url, fit: user.fit, position: user.position, opacity: 1, blur: user.blur, overlayColor: modeState.userImage!.overlayColor, overlayOpacity: user.dim })
  }
  const background = modeState.background
  return background.type === 'image'
    ? validBackdrop({ url: background.url, fit: background.fit, position: background.position, opacity: background.opacity, blur: background.blur, overlayColor: background.overlay.color, overlayOpacity: background.overlay.opacity })
    : null
})
</script>

<template>
  <div class="panel-theme-preview" role="img" :aria-label="label" :style="style">
    <PanelThemeBackdrop :backdrop="backdrop" />
    <div class="preview-content" inert aria-hidden="true">
      <div class="preview-header">{{ t('design.panelTheme.previewTitle') }}</div>
      <div class="preview-card">
        <span class="preview-text">{{ t('design.panelTheme.previewBody') }}</span>
        <span class="preview-secondary">{{ t('design.panelTheme.previewMuted') }}</span>
        <span class="preview-muted">{{ t('design.panelTheme.previewMuted') }}</span>
        <span class="preview-states">
          <span class="preview-danger">{{ t('design.panelTheme.previewDanger') }}</span>
          <span class="preview-success">{{ t('design.panelTheme.previewSuccess') }}</span>
        </span>
        <span class="preview-button">{{ t('design.panelTheme.previewButton') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-theme-preview {
  /* Never inherit the live panel's gradient; a gradient preview sets it inline. */
  --panel-theme-background: initial;

  position: relative;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid var(--organic-border);
  border-radius: var(--organic-radius-md);
  background: var(--panel-theme-background, var(--organic-bg));
  color: var(--organic-text);
  font-family: var(--organic-font-body);
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}

.preview-header {
  overflow: hidden;
  font-family: var(--organic-font-heading);
  font-size: var(--organic-font-heading-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--organic-border-soft);
  border-radius: var(--organic-radius-sm);
  background: var(--organic-surface);
  font-size: var(--organic-font-body-sm);
}

.preview-text,
.preview-secondary,
.preview-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-secondary {
  color: var(--organic-text-secondary);
}

.preview-muted {
  color: var(--organic-text-muted);
}

.preview-states {
  display: flex;
  gap: var(--space-2);
}

.preview-danger {
  color: var(--organic-danger-text);
}

.preview-success {
  color: var(--organic-success-text);
}

.preview-button {
  align-self: flex-start;
  padding: 2px var(--space-2);
  border-radius: var(--organic-radius-sm);
  background: var(--organic-accent-hover);
  color: var(--organic-accent-contrast);
}
</style>
