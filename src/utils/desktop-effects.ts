export function isDesktopEffectActive(
  preferencesReady: boolean,
  dndEnabled: boolean,
  effectEnabled: boolean,
): boolean {
  return preferencesReady && !dndEnabled && effectEnabled
}
