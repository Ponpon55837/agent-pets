import { ref } from 'vue'
import type { SettingsSectionId } from './settingsRegistry.ts'

// In-panel "go to this settings section" requests (for example the plugin
// detail's "Panel themes" link to General -> Appearance). SettingsPage owns the
// navigation; the nonce makes repeated requests for the same section fire.
export const settingsSectionRequest = ref<{ section: SettingsSectionId; nonce: number } | null>(null)
let nonce = 0

export function requestSettingsSection(section: SettingsSectionId): void {
  nonce += 1
  settingsSectionRequest.value = { section, nonce }
}
