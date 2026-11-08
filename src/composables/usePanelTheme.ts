import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { resolvedTheme } from '@/composables/useTheme'
import { isPanelThemeFit, isPanelThemePosition, type PanelThemeFit, type PanelThemeMode, type PanelThemePosition, type PanelThemeState } from '@/types/panel-theme'
import {
  activePanelTheme,
  diffPanelThemeProperties,
  isPanelThemeAssetUrl,
  isPanelThemeFontAlias,
  isPanelThemePropertyValue,
  panelThemeTargetProperties,
  type PanelThemeMediaFlags,
} from '@/utils/panel-theme-css'

// Applies the plugin panel theme for the resolved light/dark mode to the
// `.status-panel` element only (spec §7.3). Every value was host-built in
// main and is re-validated here; writes are diffed and batched in one frame.

export interface PanelThemeBackdropView {
  url: string
  fit: PanelThemeFit
  position: PanelThemePosition
  opacity: number
  blur: number
  overlayColor: string
  overlayOpacity: number
}

const FONT_LOAD_TIMEOUT_MS = 1500

/** Shared with the Settings card so both see the same state. */
export const panelThemeState = shallowRef<PanelThemeState | null>(null)

export function setPanelThemeState(next: PanelThemeState | null): void {
  panelThemeState.value = next
}

export async function refreshPanelThemeState(): Promise<void> {
  try {
    const result = await window.electronAPI?.getPanelThemeState()
    if (result?.ok) panelThemeState.value = result.value
  } catch {}
}

function mediaQuery(query: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(query) : null
}

export const panelThemeMedia = ref<PanelThemeMediaFlags & { reducedTransparency: boolean }>({
  forcedColors: false,
  highContrast: false,
  reducedTransparency: false,
})

function readMedia(): void {
  panelThemeMedia.value = {
    forcedColors: mediaQuery('(forced-colors: active)')?.matches === true,
    highContrast: mediaQuery('(prefers-contrast: more)')?.matches === true,
    reducedTransparency: mediaQuery('(prefers-reduced-transparency: reduce)')?.matches === true
      || (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-gpu-safe')),
  }
}

/** Re-checks every backdrop value against the closed host shapes. */
export function validBackdrop(view: PanelThemeBackdropView | null): PanelThemeBackdropView | null {
  if (!view || !isPanelThemeAssetUrl(view.url) || !isPanelThemePropertyValue('--organic-bg', view.overlayColor)) return null
  if (!isPanelThemeFit(view.fit) || !isPanelThemePosition(view.position)) return null
  const inRange = (value: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  if (!inRange(view.opacity, 0.2, 1) || !inRange(view.overlayOpacity, 0.5, 0.95) || !Number.isInteger(view.blur) || !inRange(view.blur, 0, 24)) return null
  return view
}

function logRejected(names: string[]): void {
  if (names.length === 0) return
  try {
    window.electronAPI?.reportRendererError?.({ message: `panel theme values rejected: ${names.slice(0, 8).join(', ')}`, kind: 'error' })
  } catch {}
}

export function usePanelTheme(panelRoot: Ref<HTMLElement | null>) {
  const applied = new Map<string, string>()
  const loadedFaces = new Map<string, FontFace>()
  let frame = 0
  let generation = 0
  let unsubscribe: (() => void) | null = null
  const queries: Array<[MediaQueryList, () => void]> = []

  const mode = computed<PanelThemeMode>(() => resolvedTheme.value)
  const entry = computed(() => activePanelTheme(panelThemeState.value, mode.value))

  const backdrop = computed<PanelThemeBackdropView | null>(() => validBackdrop(rawBackdrop()))

  function rawBackdrop(): PanelThemeBackdropView | null {
    const modeState = entry.value?.modes[mode.value]
    if (!modeState || panelThemeMedia.value.forcedColors || panelThemeMedia.value.reducedTransparency) return null
    const user = modeState.userImage?.current
    if (user && isPanelThemeAssetUrl(user.url)) {
      return { url: user.url, fit: user.fit, position: user.position, opacity: 1, blur: user.blur, overlayColor: modeState.userImage!.overlayColor, overlayOpacity: user.dim }
    }
    const background = modeState.background
    if (background.type === 'image' && isPanelThemeAssetUrl(background.url)) {
      return {
        url: background.url,
        fit: background.fit,
        position: background.position,
        opacity: background.opacity,
        blur: background.blur,
        overlayColor: background.overlay.color,
        overlayOpacity: background.overlay.opacity,
      }
    }
    return null
  }

  /** Loads the faces of every theme assigned to a slot; drops faces no slot uses. */
  async function syncFonts(): Promise<void> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return
    const wanted = new Map<string, { alias: string; url: string; weight: number; style: string }>()
    if (!panelThemeMedia.value.forcedColors) {
      for (const slotMode of ['light', 'dark'] as const) {
        for (const face of activePanelTheme(panelThemeState.value, slotMode)?.shared.fonts ?? []) {
          if (!isPanelThemeFontAlias(face.alias) || !isPanelThemeAssetUrl(face.url)) continue
          wanted.set(`${face.alias}|${face.weight}|${face.style}|${face.url}`, face)
        }
      }
    }
    for (const [key, face] of loadedFaces) {
      if (wanted.has(key)) continue
      document.fonts.delete(face)
      loadedFaces.delete(key)
    }
    const loads: Array<Promise<unknown>> = []
    for (const [key, face] of wanted) {
      if (loadedFaces.has(key)) continue
      const fontFace = new FontFace(face.alias, `url("${face.url}")`, { weight: String(face.weight), style: face.style, display: 'swap' })
      loadedFaces.set(key, fontFace)
      document.fonts.add(fontFace)
      loads.push(fontFace.load())
    }
    if (loads.length === 0) return
    await Promise.race([
      Promise.allSettled(loads),
      new Promise(resolve => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
    ])
  }

  async function apply(): Promise<void> {
    const current = ++generation
    await syncFonts()
    if (current !== generation) return
    const plan = panelThemeTargetProperties(entry.value, mode.value, panelThemeMedia.value)
    logRejected(plan.rejected)
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      const element = panelRoot.value
      if (!element || current !== generation) return
      const { remove, set } = diffPanelThemeProperties(applied, plan.properties)
      for (const name of remove) {
        element.style.removeProperty(name)
        applied.delete(name)
      }
      for (const [name, value] of set) {
        element.style.setProperty(name, value)
        applied.set(name, value)
      }
      if (plan.properties.size > 0) element.dataset.panelTheme = 'plugin'
      else delete element.dataset.panelTheme
    })
  }

  watch([panelThemeState, mode, panelThemeMedia], () => { void apply() }, { deep: false })

  onMounted(() => {
    readMedia()
    for (const query of ['(forced-colors: active)', '(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']) {
      const list = mediaQuery(query)
      if (!list) continue
      list.addEventListener('change', readMedia)
      queries.push([list, readMedia])
    }
    unsubscribe = window.electronAPI?.onPanelThemeChanged?.(state => setPanelThemeState(state)) ?? null
    void refreshPanelThemeState()
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    for (const [list, listener] of queries) list.removeEventListener('change', listener)
    if (frame) cancelAnimationFrame(frame)
    for (const face of loadedFaces.values()) document.fonts.delete(face)
    loadedFaces.clear()
  })

  return { backdrop, entry, mode }
}
