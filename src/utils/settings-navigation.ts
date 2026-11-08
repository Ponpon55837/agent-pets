import { ref } from 'vue'
import { requestPluginDetail } from '@/utils/plugin-detail-request'
import type { SettingsSectionId } from '@/utils/settingsRegistry'

// 面板內「前往這個設定區塊」的請求。導覽由 SettingsPage 負責；
// nonce 讓同一區塊的重複請求也會觸發。
export const settingsSectionRequest = ref<{ section: SettingsSectionId; nonce: number } | null>(null)
let nonce = 0

export function requestSettingsSection(section: SettingsSectionId): void {
  nonce += 1
  settingsSectionRequest.value = { section, nonce }
}

/** 面板主題位於 Plugins -> <plugin> -> Panel themes；沒有主題插件時位於 Appearance。 */
export function openPanelThemeSettings(pluginId: string | null): void {
  if (pluginId) {
    requestPluginDetail(pluginId, 'themes')
    requestSettingsSection('plugins')
  } else {
    requestSettingsSection('appearance')
  }
}
