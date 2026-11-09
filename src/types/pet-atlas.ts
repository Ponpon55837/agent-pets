// 寵物 sprite 圖集規格的單一來源：主程序（匯入驗證、behaviorManifest 解析）與畫面端
// （PetAnimation、預覽、視窗尺寸）都從這裡取格子尺寸、列號與動作定義。
// tests/*.test.mts 會用 Node 直接執行這個檔，所以不得 import 任何 src 模組。

/** 每一格的像素尺寸；圖集寬高必須是它的整數倍。 */
export const PET_CELL_WIDTH = 192
export const PET_CELL_HEIGHT = 208

// 內建 Codex 寵物（public/pets/*）的兩種圖集版本：
//   v1：8 欄 x 9 列（1536x1872）
//   v2：8 欄 x 11 列（1536x2288），第 9–10 列是「看向」動作
//       （public/pets/qitian-dasheng/validation.json），不是走路或睡覺。
export const PET_ATLAS_COLUMNS = 8
export const PET_ATLAS_V1_ROWS = 9
export const PET_ATLAS_V2_ROWS = 11
/** 第 0–8 列（idle … review）是每個版本都必備的。 */
export const PET_ATLAS_MIN_ROWS = PET_ATLAS_V1_ROWS
/** 第 1 列在兩個版本都是 running-right，v2 預設拿來走路。 */
export const PET_ATLAS_WALK_ROW = 1

// 從檔頭就能檢查的上限（不必解碼），避免一張高度壓縮的小檔讓畫面端配置數 GB 記憶體。
export const PET_ATLAS_MAX_COLUMNS = 32
export const PET_ATLAS_MAX_ROWS = 64
export const PET_ATLAS_MAX_PIXELS = 16 * 1024 * 1024

/** 圖集列名；和 types/agent.ts 的狀態標籤一樣是技術識別字，維持英文。 */
export const PET_ATLAS_ROW_NAMES = [
  'idle', 'running-right', 'running-left', 'waving', 'jumping',
  'failed', 'waiting', 'running', 'review', 'look 0-157.5°', 'look 180-337.5°',
] as const

/** 圖集固定列提供的動作。 */
export type PetAtlasMotionName = 'idle' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'running' | 'review'
/** 只有寵物包宣告後才有的動作；沒宣告時回退成 idle。 */
export type PetOptionalMotionName = 'walk' | 'sleep'
export type PetMotionName = PetAtlasMotionName | PetOptionalMotionName

export const PET_OPTIONAL_MOTION_NAMES: readonly PetOptionalMotionName[] = ['walk', 'sleep']
export const PET_MOTION_NAMES: readonly PetMotionName[] = [
  'idle', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review', ...PET_OPTIONAL_MOTION_NAMES,
]

export interface PetMotionDefinition {
  name: PetMotionName
  row: number
  frameDurations: readonly number[]
}

// 每列的格數決定動作的節奏，也防止 waving、jumping 這類短動作踩進透明格。
export const PET_ATLAS_MOTIONS: Readonly<Record<PetAtlasMotionName, PetMotionDefinition>> = {
  idle: { name: 'idle', row: 0, frameDurations: [280, 110, 110, 140, 140, 320] },
  waving: { name: 'waving', row: 3, frameDurations: [140, 140, 140, 280] },
  jumping: { name: 'jumping', row: 4, frameDurations: [140, 140, 140, 140, 280] },
  failed: { name: 'failed', row: 5, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { name: 'waiting', row: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
  running: { name: 'running', row: 7, frameDurations: [120, 120, 120, 120, 120, 220] },
  review: { name: 'review', row: 8, frameDurations: [150, 150, 150, 150, 150, 280] },
}

/** behaviorManifest 的上下限；主程序解析與畫面端套用共用同一組數字。 */
export const PET_MOTION_MAX_FRAMES = 16
export const PET_MOTION_MIN_FRAME_MS = 60
export const PET_MOTION_MAX_FRAME_MS = 3_000
/** 只宣告列號、沒給時長時，每格與最後一格的預設時長。 */
export const PET_MOTION_DEFAULT_FRAME_MS = 150
export const PET_MOTION_DEFAULT_LAST_FRAME_MS = 260

export interface PetMotionOverride {
  row: number
  frames?: number
  frameDurations?: number[]
}

/** pet.json／插件外觀的 behaviorManifest：任何動作都能被覆蓋。 */
export type PetMotionManifest = Partial<Record<PetMotionName, PetMotionOverride>>

export interface PetAtlasGrid {
  columns: number
  rows: number
}

export function petAtlasGridFromSize(width: number, height: number): PetAtlasGrid {
  return { columns: Math.floor(width / PET_CELL_WIDTH), rows: Math.floor(height / PET_CELL_HEIGHT) }
}

/** 覆蓋值放不進圖集（列不存在或格數超過欄數）時回傳 false，呼叫端應改用內建值。 */
export function petMotionFitsAtlas(override: PetMotionOverride, grid: PetAtlasGrid): boolean {
  if (override.row >= grid.rows) return false
  return override.frames === undefined || override.frames <= grid.columns
}

function fitFrameDurations(source: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => source[index]
    ?? (index === count - 1 ? PET_MOTION_DEFAULT_LAST_FRAME_MS : PET_MOTION_DEFAULT_FRAME_MS))
}

/**
 * 依寵物包的 behaviorManifest 決定一個動作實際要播的列與每格時長。
 * `grid` 未知（圖還沒載入）時只套用解析器的上下限；載入後會重算並排除放不下的覆蓋值。
 * 時長陣列永遠和格數一樣長，畫面端不會讀到 undefined。
 */
export function resolvePetMotion(name: PetMotionName, manifest: PetMotionManifest | undefined, grid: PetAtlasGrid | null): PetMotionDefinition {
  const declared = manifest?.[name]
  const override = declared && (!grid || petMotionFitsAtlas(declared, grid)) ? declared : undefined
  const builtin = name in PET_ATLAS_MOTIONS ? PET_ATLAS_MOTIONS[name as PetAtlasMotionName] : undefined
  if (!override) {
    if (!builtin) return resolvePetMotion('idle', manifest, grid)
    if (!grid || builtin.frameDurations.length <= grid.columns) return builtin
  }
  const frameLimit = Math.max(1, Math.min(PET_MOTION_MAX_FRAMES, grid?.columns ?? PET_MOTION_MAX_FRAMES))
  const wanted = override?.frames
    ?? override?.frameDurations?.length
    ?? builtin?.frameDurations.length
    ?? grid?.columns
    ?? PET_ATLAS_MOTIONS.idle.frameDurations.length
  const count = Math.max(1, Math.min(frameLimit, wanted))
  return {
    name,
    row: override?.row ?? builtin!.row,
    frameDurations: fitFrameDurations(override?.frameDurations ?? builtin?.frameDurations ?? [], count),
  }
}
