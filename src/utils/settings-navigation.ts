import { ref } from 'vue'
import { requestPluginDetail } from './plugin-detail-request.ts'
import type { SettingsSectionId } from './settingsRegistry.ts'

// In-panel "go to this settings section" requests. SettingsPage owns the
// navigation; the nonce makes repeated requests for the same section fire.
export const settingsSectionRequest = ref<{ section: SettingsSectionId; nonce: number } | null>(null)
let nonce = 0

export function requestSettingsSection(section: SettingsSectionId): void {
  nonce += 1
  settingsSectionRequest.value = { section, nonce }
}

/** Panel themes live in Plugins -> <plugin> -> Panel themes; without a theme plugin, in Appearance. */
export function openPanelThemeSettings(pluginId: string | null): void {
  if (pluginId) {
    requestPluginDetail(pluginId, 'themes')
    requestSettingsSection('plugins')
  } else {
    requestSettingsSection('appearance')
  }
}
