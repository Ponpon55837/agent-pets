// Panel window geometry shared by the renderer (which requests a size) and the
// main process (which places the window). Kept free of Electron/Vue imports so
// both sides and the unit tests can load it.

export interface PanelSize { width: number; height: number }
export interface PanelRect extends PanelSize { x: number; y: number }

export const PANEL_WIDTH = 460
export const PANEL_MIN_WIDTH = 320
export const PANEL_MAX_WIDTH = 960
export const PANEL_MIN_HEIGHT = 160
export const PANEL_MAX_HEIGHT = 900
export const PANEL_GAP = 6

export type PanelSizeKey = 'sessions' | 'settings' | 'wizard' | 'mcp'

// Single source of truth for the size every panel route asks for. The main
// process still shrinks the height to fit the display's work area.
// The dashboard and Settings share one size on purpose: switching between them
// must not resize or move the window (the old 560 -> 720 jump read as jitter).
export const PANEL_HEIGHT = 720
export const PANEL_SIZES: Record<PanelSizeKey, PanelSize> = {
  sessions: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
  settings: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
  wizard: { width: 680, height: 520 },
  mcp: { width: 720, height: 560 },
}

// The tallest panel that still leaves a gap above and below inside the work area.
export function fitPanelHeight(height: number, workAreaHeight: number, gap = PANEL_GAP): number {
  const ceiling = Math.max(PANEL_MIN_HEIGHT, Math.floor(workAreaHeight - gap * 2))
  return Math.round(Math.min(Math.max(height, PANEL_MIN_HEIGHT), PANEL_MAX_HEIGHT, ceiling))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface PlacementInput {
  petBounds: PanelRect
  petContentHeight: number | null
  petHeadroom: number
  workArea: PanelRect
  width: number
  height: number
  gap?: number
}

// Anchors the panel to the visible pet sprite, preferring above and falling
// back to below, and guarantees the result lies fully inside the work area.
export function computePanelPlacement(input: PlacementInput): PanelRect {
  const gap = input.gap ?? PANEL_GAP
  const { petBounds, workArea } = input
  const width = Math.round(clampNumber(input.width, PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, workArea.width)))
  const height = fitPanelHeight(input.height, workArea.height, gap)
  const visibleHeight = input.petContentHeight !== null
    ? clampNumber(input.petContentHeight, 40, petBounds.height)
    : petBounds.height - input.petHeadroom
  const visibleTop = petBounds.y + petBounds.height - visibleHeight
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)
  const aboveY = visibleTop - height - gap
  const belowY = visibleTop + visibleHeight + gap
  let y = aboveY
  if (aboveY < workArea.y && belowY + height <= workArea.y + workArea.height) y = belowY
  const x = clampNumber(petBounds.x + Math.round(petBounds.width / 2) - Math.round(width / 2), workArea.x, maxX)
  return { x, y: clampNumber(y, workArea.y, maxY), width, height }
}

// Delay before a blurred panel hides; long enough for the pet-click toggle IPC
// to arrive first and for the Win32 fullscreen detector to classify the blur.
export const PANEL_BLUR_HIDE_DELAY_MS = 100

export interface PanelBlurState {
  dialogOpen: boolean
  petFocused: boolean
  pinned: boolean
  modalOpen: boolean
}

// Hide-on-blur is only for a genuine click-away: not while a native dialog is
// open, while the pet was just clicked (the toggle owns that case), while the
// user pinned the panel, or while a wizard / confirmation is in progress.
export function shouldHidePanelOnBlur(state: PanelBlurState): boolean {
  return !state.dialogOpen && !state.petFocused && !state.pinned && !state.modalOpen
}
