/**
 * Some Windows display drivers crash Chromium's GPU process while the Vite
 * renderer is active. Limit software rendering to that development path so
 * packaged builds and other platforms retain hardware acceleration.
 */
export function shouldDisableDevHardwareAcceleration(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  devServerUrl: string | undefined,
  disableGpuPreference: string | undefined,
): boolean {
  return platform === 'win32'
    && !isPackaged
    && Boolean(devServerUrl)
    && disableGpuPreference === '1'
}
