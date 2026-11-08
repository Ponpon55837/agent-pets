// One-shot hand-off from the dashboard plugin tab to Settings -> Plugins: the tab
// records which plugin detail to open, and the plugin panel consumes it once it
// has loaded its list. Kept outside both components so remounting cannot replay it.
import { ref } from 'vue'

export type PluginDetailRequestSection = 'overview' | 'settings' | 'commands' | 'themes' | 'diagnostics'

/** Bumped on every request so an already-mounted plugin panel can consume it too. */
export const pluginDetailRequestNonce = ref(0)

let pending: { pluginId: string; section: PluginDetailRequestSection } | null = null

export function requestPluginDetail(pluginId: string, section: PluginDetailRequestSection = 'overview'): void {
  pending = { pluginId, section }
  pluginDetailRequestNonce.value += 1
}

export function takePluginDetailRequest(): { pluginId: string; section: PluginDetailRequestSection } | null {
  const request = pending
  pending = null
  return request
}
