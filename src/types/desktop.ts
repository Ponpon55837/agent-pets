import type { AppLocale } from '@/types/locale'
import type { DesktopVisibilityCapabilities } from '@/types/desktop-visibility'

export interface DesktopPreferences {
  dndEnabled: boolean
  notificationsEnabled: boolean
  permissionBubbleEnabled: boolean
  presentationMcpEnabled: boolean
  achievementsEnabled: boolean
  edgeModeEnabled: boolean
  shimejiEnabled: boolean
  captureExclusionEnabled: boolean
  fullscreenAutoHideEnabled: boolean
  rightClickHideEnabled: boolean
  soundEnabled: boolean
  launchAtStartup: boolean
  launchAtStartupSupported: boolean
  locale: AppLocale
  visibilityCapabilities: DesktopVisibilityCapabilities
}

export type DesktopPreferencesPatch = Partial<Pick<
  DesktopPreferences,
  'dndEnabled'
  | 'notificationsEnabled'
  | 'permissionBubbleEnabled'
  | 'presentationMcpEnabled'
  | 'achievementsEnabled'
  | 'edgeModeEnabled'
  | 'shimejiEnabled'
  | 'captureExclusionEnabled'
  | 'fullscreenAutoHideEnabled'
  | 'rightClickHideEnabled'
  | 'soundEnabled'
  | 'launchAtStartup'
  | 'locale'
>>
