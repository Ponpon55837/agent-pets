/**
 * Some Windows display drivers crash Chromium's GPU process while the Vite
 * renderer is active. Limit software rendering to the explicit development
 * safe mode so packaged builds and other platforms retain acceleration.
 */
export function shouldDisableDevHardwareAcceleration(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  devServerUrl: string | undefined,
  safeModePreference: string | undefined,
): boolean {
  return platform === 'win32'
    && !isPackaged
    && Boolean(devServerUrl)
    && safeModePreference === '1'
}
