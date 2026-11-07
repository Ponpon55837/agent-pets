// Structural checks for imported spritesheets: the renderer slices a fixed
// 192x208 grid, so a sheet with other dimensions renders as blank or garbled
// cells without any error. These read only the image header.

export const SPRITE_CELL_WIDTH = 192
export const SPRITE_CELL_HEIGHT = 208
/** Rows 0-8 are used by the v2 atlas (idle ... review). */
export const SPRITE_MIN_ROWS = 9

export type SpriteValidationError = 'E_TYPE' | 'E_SIZE' | 'E_ROWS'

export const SPRITE_ERROR_MESSAGES: Record<SpriteValidationError, string> = {
  E_TYPE: 'Spritesheet dimensions could not be read',
  E_SIZE: 'Spritesheet size must be a multiple of the 192x208 frame grid and within the maximum dimensions',
  E_ROWS: 'Spritesheet needs at least 9 animation rows',
}

export interface ImageSize {
  width: number
  height: number
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readPngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) }
}

function readWebpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunk === 'VP8X') {
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 }
  }
  if (chunk === 'VP8 ') {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  return null
}

function readJpegSize(bytes: Uint8Array): ImageSize | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] }
    }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return readPngSize(bytes)
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return readWebpSize(bytes)
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegSize(bytes)
  return null
}

// Upper bounds read from the image header (no decode needed) so a tiny, highly compressed file
// cannot make the renderer allocate gigabytes.
export const SPRITE_MAX_WIDTH = SPRITE_CELL_WIDTH * 32
export const SPRITE_MAX_HEIGHT = SPRITE_CELL_HEIGHT * 64
export const SPRITE_MAX_PIXELS = 16 * 1024 * 1024

export function validateSpriteSheet(bytes: Uint8Array): { ok: true; size: ImageSize } | { ok: false; code: SpriteValidationError } {
  const size = readImageSize(bytes)
  if (!size || size.width <= 0 || size.height <= 0) return { ok: false, code: 'E_TYPE' }
  if (size.width % SPRITE_CELL_WIDTH !== 0 || size.height % SPRITE_CELL_HEIGHT !== 0) {
    return { ok: false, code: 'E_SIZE' }
  }
  if (size.width > SPRITE_MAX_WIDTH || size.height > SPRITE_MAX_HEIGHT || size.width * size.height > SPRITE_MAX_PIXELS) {
    return { ok: false, code: 'E_SIZE' }
  }
  if (size.height / SPRITE_CELL_HEIGHT < SPRITE_MIN_ROWS) return { ok: false, code: 'E_ROWS' }
  return { ok: true, size }
}
