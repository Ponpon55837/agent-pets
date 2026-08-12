export interface DesktopPreferences {
  dndEnabled: boolean
  notificationsEnabled: boolean
  permissionBubbleEnabled: boolean
  soundEnabled: boolean
  launchAtStartup: boolean
  launchAtStartupSupported: boolean
}

export type DesktopPreferencesPatch = Partial<Pick<
  DesktopPreferences,
  'dndEnabled'
  | 'notificationsEnabled'
  | 'permissionBubbleEnabled'
  | 'soundEnabled'
  | 'launchAtStartup'
>>
