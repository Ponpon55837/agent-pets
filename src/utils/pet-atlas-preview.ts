import type { PetImportAtlas } from '../types/pet-import.ts'
import { PET_ATLAS_MOTIONS, PET_ATLAS_ROW_NAMES } from '../types/pet-atlas.ts'

/** 和 PetAnimation 播的 idle 格數一致。 */
export const PREVIEW_IDLE_FRAMES = PET_ATLAS_MOTIONS.idle.frameDurations.length
export const PREVIEW_IDLE_FRAME_MS = 160
/** Preview rows are bounded so a tall (but valid) sheet cannot flood the dialog. */
export const PREVIEW_MAX_ROWS = 16

export function atlasRowName(row: number): string {
  return PET_ATLAS_ROW_NAMES[row] ?? `row ${row}`
}

/** Inline style that shows one atlas cell scaled to `scale`, without decoding the image in script. */
export function atlasCellStyle(atlas: PetImportAtlas, url: string, row: number, column: number, scale: number): Record<string, string> {
  const width = Math.round(atlas.frameWidth * scale)
  const height = Math.round(atlas.frameHeight * scale)
  return {
    width: `${width}px`,
    height: `${height}px`,
    backgroundImage: `url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${Math.round(atlas.width * scale)}px ${Math.round(atlas.height * scale)}px`,
    backgroundPosition: `-${column * width}px -${row * height}px`,
  }
}

/** Only agent-pets://import-preview/<token>/spritesheet URLs are rendered. */
export function isImportPreviewUrl(value: unknown): value is string {
  return typeof value === 'string' && /^agent-pets:\/\/import-preview\/[0-9a-f]{32}\/spritesheet$/.test(value)
}
