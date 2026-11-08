<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { PanelThemeCatalogEntry, PanelThemeColorProperty, PanelThemeMode } from '@/types/panel-theme'
import { isPanelThemePropertyValue, panelThemeTargetProperties, petStatusPreviewProperties } from '@/utils/panel-theme-css'
import { validBackdrop, type PanelThemeBackdropView } from '@/composables/usePanelTheme'
import PanelThemeBackdrop from '@/components/PanelThemeBackdrop.vue'

// 面板的靜態模擬，將單一主題模式以 inline 套用到
// .panel-theme-preview 元素上（與面板使用相同的已驗證屬性對應表）。
// 內建預覽使用主機該模式的內建色盤。

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
    for (const [name, value] of petStatusPreviewProperties(props.entry.modes[props.mode]?.petStatus)) {
      result[name] = value
    }
  } else if (props.builtin) {
    for (const [name, value] of Object.entries(props.builtin)) {
      if (isPanelThemePropertyValue(name, value)) result[name] = value
    }
  }
  return result
})

// 套用 petStatus 的膠囊在寵物視窗不畫文字陰影（DesktopPet.css），預覽照做。
const themedPill = computed(() => !props.forcedColors && Boolean(props.entry?.modes[props.mode]?.petStatus))

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
  <!-- data-mode：陰影與高光強度依「被預覽的模式」解析（tokens.css），不是面板目前的模式。 -->
  <div class="panel-theme-preview" role="img" :aria-label="label" :data-mode="mode" :style="style">
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
      <!-- 寵物的狀態膠囊（寵物唯一可套主題的介面）。 -->
      <div class="preview-pill" :class="{ themed: themedPill }">
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
  /* 絕不繼承即時面板的漸層；漸層預覽會以 inline 設定。 */
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
  box-shadow: var(--organic-card-shadow);
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
  background:
    linear-gradient(160deg, var(--pet-gloss) 0%, transparent 55%),
    var(--pet-status-background, var(--organic-status-surface-fallback));
  box-shadow: var(--organic-status-shadow), var(--organic-status-highlight);
  color: var(--pet-status-text, var(--organic-status-text));
  text-shadow: var(--text-shadow-panel);
  font-size: var(--font-xs);
  white-space: nowrap;
}

.preview-pill.themed {
  text-shadow: none;
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
