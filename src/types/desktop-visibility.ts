/**
 * Capabilities are projected by the main process so the renderer can explain
 * platform limits instead of presenting an action that cannot work.
 */
export type CaptureExclusionMode = 'system' | 'limited' | 'unsupported'
export type FullscreenAutoHideMode = 'macos-native' | 'unsupported'

export interface DesktopVisibilityCapabilities {
  captureExclusion: {
    supported: boolean
    mode: CaptureExclusionMode
  }
  fullscreenAutoHide: {
    supported: boolean
    mode: FullscreenAutoHideMode
  }
}

export const UNSUPPORTED_DESKTOP_VISIBILITY_CAPABILITIES: DesktopVisibilityCapabilities = {
  captureExclusion: {
    supported: false,
    mode: 'unsupported',
  },
  fullscreenAutoHide: {
    supported: false,
    mode: 'unsupported',
  },
}

