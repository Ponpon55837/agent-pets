<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Select from '@/components/ui/Select.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import PanelThemePreview from '@/components/status-panel/PanelThemePreview.vue'
import { panelThemeMedia, panelThemeState, refreshPanelThemeState, setPanelThemeState } from '@/composables/usePanelTheme'
import {
  PANEL_THEME_FITS,
  PANEL_THEME_MODES,
  PANEL_THEME_POSITIONS,
  PANEL_THEME_USER_BLURS,
  type PanelThemeCatalogEntry,
  type PanelThemeFit,
  type PanelThemeIpcResult,
  type PanelThemeMode,
  type PanelThemePosition,
  type PanelThemeRef,
  type PanelThemeUserImageOptions,
} from '@/types/panel-theme'

// Settings -> General -> Appearance -> Panel theme (spec §8). The whole card is
// .host-protected, so it always renders with built-in tokens and the user can
// always get back to the built-in look.

const refKey = (ref: PanelThemeRef | null) => (ref ? `${ref.pluginId}/${ref.themeId}` : '')
const MODE_LABEL: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.lightSlot', dark: 'design.panelTheme.darkSlot' }
const MODE_NAME: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeLight', dark: 'design.panelTheme.modeDark' }
const FIT_LABEL: Record<PanelThemeFit, TranslationKey> = {
  cover: 'design.panelTheme.image.fitCover', contain: 'design.panelTheme.image.fitContain', tile: 'design.panelTheme.image.fitTile',
}
const POSITION_LABEL: Record<PanelThemePosition, TranslationKey> = {
  center: 'design.panelTheme.image.positionCenter', top: 'design.panelTheme.image.positionTop', bottom: 'design.panelTheme.image.positionBottom',
  left: 'design.panelTheme.image.positionLeft', right: 'design.panelTheme.image.positionRight',
  'top-left': 'design.panelTheme.image.positionTopLeft', 'top-right': 'design.panelTheme.image.positionTopRight',
  'bottom-left': 'design.panelTheme.image.positionBottomLeft', 'bottom-right': 'design.panelTheme.image.positionBottomRight',
}
const ERROR_KEY: Record<string, TranslationKey> = {
  image_invalid: 'design.panelTheme.error.imageInvalid',
  image_too_large: 'design.panelTheme.error.imageTooLarge',
  image_not_allowed: 'design.panelTheme.error.imageNotAllowed',
  theme_unavailable: 'design.panelTheme.error.themeUnavailable',
}

const root = ref<HTMLElement | null>(null)
const visible = ref(false)
const busy = ref(false)
const status = ref('')
const error = ref('')
const pending = ref<Record<PanelThemeMode, string>>({ light: '', dark: '' })
const dirty = ref(false)
const lastEdited = ref<PanelThemeMode>('light')
let observer: IntersectionObserver | null = null

const state = computed(() => panelThemeState.value)
const themes = computed(() => state.value?.themes ?? [])
const committed = computed<Record<PanelThemeMode, string>>(() => ({
  light: refKey(state.value?.slots.light.ref ?? null),
  dark: refKey(state.value?.slots.dark.ref ?? null),
}))

function syncPending(): void {
  if (!dirty.value) pending.value = { ...committed.value }
}
watch(committed, syncPending, { immediate: true })

function entryFor(key: string): PanelThemeCatalogEntry | null {
  return themes.value.find(entry => refKey(entry.ref) === key) ?? null
}

function themeLabel(entry: PanelThemeCatalogEntry): string {
  return t('design.panelTheme.optionLabel', { theme: entry.displayName[locale.value], plugin: entry.pluginName[locale.value] })
}

function optionsFor(mode: PanelThemeMode): Array<{ value: string; label: string }> {
  const options = [{ value: '', label: t('design.panelTheme.builtIn') }]
  for (const entry of themes.value) if (entry.modes[mode]) options.push({ value: refKey(entry.ref), label: themeLabel(entry) })
  // A selected theme that is currently unavailable stays visible (ids only; both are validated patterns).
  const slotRef = state.value?.slots[mode].ref
  if (slotRef && !options.some(option => option.value === refKey(slotRef))) {
    options.push({ value: refKey(slotRef), label: `${slotRef.themeId} · ${slotRef.pluginId}` })
  }
  return options
}

function choose(mode: PanelThemeMode, value: string): void {
  pending.value = { ...pending.value, [mode]: value }
  lastEdited.value = mode
  dirty.value = pending.value.light !== committed.value.light || pending.value.dark !== committed.value.dark
  status.value = ''
}

const useForBoth = computed(() => {
  const mode = lastEdited.value
  const other: PanelThemeMode = mode === 'light' ? 'dark' : 'light'
  const entry = entryFor(pending.value[mode])
  return entry && entry.modes.light && entry.modes.dark && pending.value[other] !== pending.value[mode] ? { mode, other } : null
})

function applyBoth(): void {
  if (!useForBoth.value) return
  choose(useForBoth.value.other, pending.value[useForBoth.value.mode])
}

function refOf(key: string): PanelThemeRef | null {
  const separator = key.indexOf('/')
  return separator > 0 ? { pluginId: key.slice(0, separator), themeId: key.slice(separator + 1) } : null
}

function handleResult(result: PanelThemeIpcResult | undefined, success?: string): boolean {
  if (!result) return false
  if (result.ok) {
    setPanelThemeState(result.value)
    if (success) status.value = success
    error.value = ''
    return true
  }
  if (result.cancelled) return false
  error.value = result.reason === 'animated' ? t('design.panelTheme.error.imageAnimated') : t(ERROR_KEY[result.error] ?? 'design.panelTheme.error.writeFailed')
  return false
}

async function apply(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    for (const mode of PANEL_THEME_MODES) {
      if (pending.value[mode] === committed.value[mode]) continue
      const result = await window.electronAPI?.setPanelThemeSlot(mode, refOf(pending.value[mode]))
      if (!handleResult(result)) return
    }
    dirty.value = false
    syncPending()
    status.value = t('design.panelTheme.applied')
  } finally {
    busy.value = false
  }
}

async function restoreBuiltIn(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    for (const mode of PANEL_THEME_MODES) {
      if (!state.value?.slots[mode].ref) continue
      if (!handleResult(await window.electronAPI?.setPanelThemeSlot(mode, null))) return
    }
    dirty.value = false
    syncPending()
    status.value = t('design.panelTheme.applied')
  } finally {
    busy.value = false
  }
}

const anySlotSet = computed(() => Boolean(state.value?.slots.light.ref || state.value?.slots.dark.ref))

function unavailableText(mode: PanelThemeMode): string {
  const slot = state.value?.slots[mode]
  if (slot?.status !== 'unavailable') return ''
  if (slot.reason === 'plugins_off') return t('design.panelTheme.unavailablePluginsOff')
  if (slot.reason === 'plugin_disabled') return t('design.panelTheme.unavailablePluginDisabled')
  return t('design.panelTheme.unavailableRemoved')
}

// ── User background image (committed, active slots only) ─────────────────
const imageModes = computed(() => PANEL_THEME_MODES.flatMap(mode => {
  const slot = state.value?.slots[mode]
  if (!slot?.ref || slot.status !== 'active') return []
  const entry = entryFor(refKey(slot.ref))
  const userImage = entry?.modes[mode]?.userImage
  return entry && userImage ? [{ mode, ref: entry.ref, userImage }] : []
}))

function dimPresets(minimum: number): number[] {
  const values = [minimum, minimum + 0.05, minimum + 0.1, 0.95].map(value => Math.min(0.95, Math.round(value * 100) / 100))
  return [...new Set(values)]
}

async function importImage(ref: PanelThemeRef, mode: PanelThemeMode): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    handleResult(await window.electronAPI?.importPanelThemeUserImage(ref, mode), t('design.panelTheme.image.imported'))
  } finally {
    busy.value = false
  }
}

async function clearImage(ref: PanelThemeRef, mode: PanelThemeMode): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    handleResult(await window.electronAPI?.clearPanelThemeUserImage(ref, mode), t('design.panelTheme.image.removed'))
  } finally {
    busy.value = false
  }
}

async function setOption(ref: PanelThemeRef, mode: PanelThemeMode, current: PanelThemeUserImageOptions, patch: Partial<PanelThemeUserImageOptions>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    handleResult(await window.electronAPI?.setPanelThemeUserImageOptions(ref, mode, { ...current, ...patch }))
  } finally {
    busy.value = false
  }
}

const fitOptions = computed(() => PANEL_THEME_FITS.map(fit => ({ value: fit, label: t(FIT_LABEL[fit]) })))
const positionOptions = computed(() => PANEL_THEME_POSITIONS.map(position => ({ value: position, label: t(POSITION_LABEL[position]) })))
const blurOptions = computed(() => PANEL_THEME_USER_BLURS.map(blur => ({ value: String(blur), label: blur === 0 ? t('design.panelTheme.image.blurNone') : `${blur}` })))

function previewLabel(mode: PanelThemeMode): string {
  const entry = entryFor(pending.value[mode])
  return t('design.panelTheme.preview', { theme: entry ? entry.displayName[locale.value] : t('design.panelTheme.builtIn'), mode: t(MODE_NAME[mode]) })
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
  <div ref="root" class="panel-theme-settings host-protected">
    <Card :title="t('design.panelTheme.title')">
      <p class="panel-theme-help">{{ t('design.panelTheme.help') }}</p>
      <p v-if="panelThemeMedia.forcedColors" class="panel-theme-note" role="status">{{ t('design.panelTheme.suspendedForcedColors') }}</p>
      <div v-for="mode in PANEL_THEME_MODES" :key="mode" class="panel-theme-row">
        <span class="panel-theme-row-label">{{ t(MODE_LABEL[mode]) }}</span>
        <Select
          class="panel-theme-select"
          :model-value="pending[mode]"
          :aria-label="t(MODE_LABEL[mode])"
          :disabled="busy"
          :data-testid="`panel-theme-select-${mode}`"
          @update:model-value="choose(mode, String($event))"
        >
          <option v-for="option in optionsFor(mode)" :key="option.value" :value="option.value">{{ option.label }}</option>
        </Select>
      </div>
      <p v-for="mode in PANEL_THEME_MODES.filter(item => unavailableText(item))" :key="`status-${mode}`" class="panel-theme-note" role="status">
        {{ t(MODE_LABEL[mode]) }}: {{ unavailableText(mode) }}
      </p>
      <div v-if="useForBoth" class="panel-theme-row panel-theme-row-end">
        <Button size="sm" variant="ghost" :disabled="busy" @click="applyBoth">{{ t('design.panelTheme.useForBoth') }}</Button>
      </div>
      <div v-if="visible" class="panel-theme-previews">
        <PanelThemePreview
          v-for="mode in PANEL_THEME_MODES"
          :key="`preview-${mode}`"
          :entry="entryFor(pending[mode])"
          :mode="mode"
          :builtin="state?.builtin[mode] ?? null"
          :label="previewLabel(mode)"
          :forced-colors="panelThemeMedia.forcedColors"
        />
      </div>
      <div class="panel-theme-actions">
        <Button size="sm" variant="secondary" :disabled="busy || !anySlotSet" data-testid="panel-theme-restore" @click="restoreBuiltIn">{{ t('design.panelTheme.restoreBuiltIn') }}</Button>
        <Button size="sm" variant="primary" :disabled="busy || !dirty" data-testid="panel-theme-apply" @click="apply">{{ t('design.panelTheme.apply') }}</Button>
      </div>
      <p class="panel-theme-live" role="status" aria-live="polite">{{ status }}</p>
      <p v-if="error" class="panel-theme-error" role="alert">{{ error }}</p>
    </Card>

    <Card v-for="item in imageModes" :key="`image-${item.mode}`" :title="t('design.panelTheme.image.forMode', { mode: t(MODE_LABEL[item.mode]) })">
      <p class="panel-theme-help">{{ t('design.panelTheme.image.help') }}</p>
      <div class="panel-theme-actions panel-theme-actions-start">
        <Button size="sm" variant="secondary" :disabled="busy" :data-testid="`panel-theme-image-choose-${item.mode}`" @click="importImage(item.ref, item.mode)">{{ t('design.panelTheme.image.choose') }}</Button>
        <Button v-if="item.userImage.current" size="sm" variant="ghost" :disabled="busy" @click="clearImage(item.ref, item.mode)">{{ t('design.panelTheme.image.remove') }}</Button>
      </div>
      <template v-if="item.userImage.current">
        <div class="panel-theme-row">
          <span class="panel-theme-row-label">{{ t('design.panelTheme.image.fit') }}</span>
          <Select :model-value="item.userImage.current.fit" size="sm" :aria-label="t('design.panelTheme.image.fit')" :disabled="busy" @update:model-value="setOption(item.ref, item.mode, item.userImage.current, { fit: $event as PanelThemeFit })">
            <option v-for="option in fitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </Select>
        </div>
        <div class="panel-theme-row">
          <span class="panel-theme-row-label">{{ t('design.panelTheme.image.position') }}</span>
          <Select :model-value="item.userImage.current.position" size="sm" :aria-label="t('design.panelTheme.image.position')" :disabled="busy" @update:model-value="setOption(item.ref, item.mode, item.userImage.current, { position: $event as PanelThemePosition })">
            <option v-for="option in positionOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </Select>
        </div>
        <div class="panel-theme-row panel-theme-row-stack">
          <span class="panel-theme-row-label">{{ t('design.panelTheme.image.dim') }}</span>
          <SegmentedControl
            :model-value="String(item.userImage.current.dim)"
            :options="dimPresets(item.userImage.minDim).map(value => ({ value: String(value), label: t('design.panelTheme.image.dimValue', { percent: Math.round(value * 100) }) }))"
            :ariaLabel="t('design.panelTheme.image.dim')"
            semantics="radio"
            size="sm"
            :id-prefix="`panel-theme-dim-${item.mode}-`"
            @update:model-value="setOption(item.ref, item.mode, item.userImage.current, { dim: Number($event) })"
          />
        </div>
        <div class="panel-theme-row panel-theme-row-stack">
          <span class="panel-theme-row-label">{{ t('design.panelTheme.image.blur') }}</span>
          <SegmentedControl
            :model-value="String(item.userImage.current.blur)"
            :options="blurOptions"
            :ariaLabel="t('design.panelTheme.image.blur')"
            semantics="radio"
            size="sm"
            :id-prefix="`panel-theme-blur-${item.mode}-`"
            @update:model-value="setOption(item.ref, item.mode, item.userImage.current, { blur: Number($event) as PanelThemeUserImageOptions['blur'] })"
          />
        </div>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.panel-theme-settings {
  display: contents;
}

.panel-theme-help,
.panel-theme-note {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.panel-theme-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.panel-theme-row-stack {
  flex-wrap: wrap;
}

.panel-theme-row-end {
  justify-content: flex-end;
}

.panel-theme-row-label {
  flex: 0 0 auto;
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.panel-theme-select {
  min-width: 0;
  max-width: 70%;
}

.panel-theme-previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.panel-theme-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.panel-theme-actions-start {
  justify-content: flex-start;
}

.panel-theme-live {
  min-height: 1em;
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.panel-theme-error {
  margin: var(--space-1) 0 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}
</style>
