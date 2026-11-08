import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { resolvedPetTheme } from '@/composables/useTheme'
import type { PetStatusThemeState } from '@/types/panel-theme'
import { diffPanelThemeProperties, petStatusTargetProperties } from '@/utils/panel-theme-css'

// 寵物視窗：套用插件主題的狀態膠囊顏色（spec §3.7）。只在寵物根元素上
// 設定 --pet-status-* 自訂屬性，且只有 .status-line 膠囊會讀取；
// 對話泡泡、權限/風險 UI、狀態點與 sprite 都不會。膠囊跟隨寵物外觀
// （dark、light 或 "follow panel"，後者追蹤 system/light/dark）。

export function usePetStatusTheme(root: Ref<HTMLElement | null>) {
  const state = shallowRef<PetStatusThemeState | null>(null)
  const forcedColors = shallowRef(false)
  const applied = new Map<string, string>()
  let frame = 0
  let unsubscribe: (() => void) | null = null
  const media = typeof matchMedia === 'function' ? matchMedia('(forced-colors: active)') : null
  const readMedia = () => { forcedColors.value = media?.matches === true }

  function apply(): void {
    const next = petStatusTargetProperties(state.value, resolvedPetTheme.value, forcedColors.value)
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      const element = root.value
      if (!element) return
      const { remove, set } = diffPanelThemeProperties(applied, next)
      for (const name of remove) {
        element.style.removeProperty(name)
        applied.delete(name)
      }
      for (const [name, value] of set) {
        element.style.setProperty(name, value)
        applied.set(name, value)
      }
      if (next.size > 0) element.dataset.petStatusTheme = 'plugin'
      else delete element.dataset.petStatusTheme
    })
  }

  watch([state, resolvedPetTheme, forcedColors, root], apply)

  onMounted(() => {
    readMedia()
    media?.addEventListener('change', readMedia)
    unsubscribe = window.electronAPI?.onPetStatusThemeChanged?.(next => { state.value = next }) ?? null
    void window.electronAPI?.getPetStatusTheme?.().then(next => { state.value = next }).catch(() => {})
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    media?.removeEventListener('change', readMedia)
    if (frame) cancelAnimationFrame(frame)
  })
}
