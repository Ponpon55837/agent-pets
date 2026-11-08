<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { PanelThemeCatalogEntry, PanelThemeColorProperty, PanelThemeMode } from '@/types/panel-theme'
import { isPanelThemePropertyValue, panelThemeTargetProperties, petStatusTargetProperties } from '@/utils/panel-theme-css'
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
    for (const [name, value] of petStatusTargetProperties({ light: null, dark: null, [props.mode]: props.entry.modes[props.mode]?.petStatus ?? null }, props.mode, false)) {
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
      <!-- The pet's status pill (the only themed pet surface). -->
      <div class="preview-pill">
        <span class="preview-pill-dot" />
        <span class="preview-pill-text">{{ t('design.panelTheme.previewPillAgent') }}<span class="preview-pill-sep">·</span>{{ t('design.panelTheme.previewPillState') }}</span>
        <span class="preview-pill-percent">62%</span>
        <span class="preview-pill-track"><span class="preview-pill-fill" /></span>
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

.preview-pill {
  position: relative;
  display: flex;
  align-items: center;
  align-self: center;
  gap: var(--space-1);
  max-width: 100%;
  overflow: hidden;
  padding: 2px var(--space-2) 5px;
  border: 1px solid var(--pet-status-border, var(--organic-status-border));
  border-radius: var(--organic-status-radius);
  background: var(--pet-status-background, var(--organic-status-surface-fallback));
  color: var(--pet-status-text, var(--organic-status-text));
  font-size: var(--font-xs);
  white-space: nowrap;
}

.preview-pill-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: var(--radius-pill);
  background: var(--state-success);
}

.preview-pill-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-pill-sep {
  margin: 0 2px;
  color: var(--pet-status-text-muted, var(--organic-status-text));
}

.preview-pill-percent {
  flex: none;
  color: var(--pet-status-quota-fill, var(--organic-quota-sage));
}

.preview-pill-track {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--pet-status-quota-track, var(--organic-status-track));
}

.preview-pill-fill {
  display: block;
  width: 62%;
  height: 100%;
  background: var(--pet-status-quota-fill, var(--organic-quota-sage));
}

.preview-button {
  align-self: flex-start;
  padding: 2px var(--space-2);
  border-radius: var(--organic-radius-sm);
  background: var(--organic-accent-hover);
  color: var(--organic-accent-contrast);
}
</style>
