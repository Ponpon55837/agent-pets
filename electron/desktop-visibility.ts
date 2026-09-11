import type { DesktopVisibilityCapabilities } from '../src/types/desktop-visibility.ts'
import { UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES } from '../src/types/desktop-visibility.ts'

/**
 * Keep platform claims explicit. Electron's content-protection API maps to a
 * system capture exclusion on Windows, while macOS has a best-effort sharing
 * exclusion that newer ScreenCaptureKit clients may ignore. Linux is not
 * advertised until it has a tested equivalent.
 */
export function desktopVisibilityCapabilitiesForPlatform(
  platform: NodeJS.Platform,
  contentProtectionAvailable: boolean,
): DesktopVisibilityCapabilities {
  const capture = platform === 'win32' && contentProtectionAvailable
    ? { supported: true, mode: 'system' as const }
    : platform === 'darwin' && contentProtectionAvailable
      ? { supported: true, mode: 'limited' as const }
      : { ...UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES.captureExclusion }

  return {
    captureExclusion: capture,
    fullscreenAutoHide: platform === 'darwin'
      ? { supported: true, mode: 'macos-native' }
      : { ...UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES.fullscreenAutoHide },
  }
}
