import type { AppLocale } from '@/types/locale'
import type { DesktopVisibilityCapabilities } from '@/types/desktop-visibility'

export type LaunchAtStartupStatus =
  | 'enabled'
  | 'disabled'
  | 'requires-approval'
  | 'not-in-applications'
  | 'unsupported'
  | 'error'

export interface DesktopPreferences {
  dndEnabled: boolean
  /** Epoch ms when a timed DND ends; null means it lasts until turned off. */
  dndUntil: number | null
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
  /** 0-100 master volume for the pet's synthesized cues. */
  soundVolume: number
  soundOnPermission: boolean
  soundOnError: boolean
  soundOnSuccess: boolean
  launchAtStartup: boolean
  launchAtStartupSupported: boolean
  /** OS-reported login item state; `launchAtStartup` stays the user's intent. */
  launchAtStartupStatus: LaunchAtStartupStatus
  locale: AppLocale
  visibilityCapabilities: DesktopVisibilityCapabilities
}

export type DesktopPreferencesPatch = Partial<Pick<
  DesktopPreferences,
  'dndEnabled'
  | 'dndUntil'
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
  | 'soundVolume'
  | 'soundOnPermission'
  | 'soundOnError'
  | 'soundOnSuccess'
  | 'launchAtStartup'
  | 'locale'
>>
