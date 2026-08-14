import type { AppLocale } from '@/types/locale'

export interface DesktopPreferences {
  dndEnabled: boolean
  notificationsEnabled: boolean
  permissionBubbleEnabled: boolean
  presentationMcpEnabled: boolean
  achievementsEnabled: boolean
  edgeModeEnabled: boolean
  shimejiEnabled: boolean
  soundEnabled: boolean
  launchAtStartup: boolean
  launchAtStartupSupported: boolean
  locale: AppLocale
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
  | 'soundEnabled'
  | 'launchAtStartup'
  | 'locale'
>>
