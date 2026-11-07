import fs from 'node:fs'
import { writeJsonAtomic } from './desktop-preferences.ts'
import type { PluginPanelSize } from './plugin-panel-window.ts'

// 使用者手動調整過的插件面板視窗尺寸，跨重新啟動保留。
// 檔案是獨立的小 JSON（版本 1），壞掉或被竄改時一律忽略，不影響插件偏好設定本身。
export const PLUGIN_PANEL_SIZES_VERSION = 1
const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
const MAX_ENTRIES = 100
const MIN_DIMENSION = 100
const MAX_DIMENSION = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_DIMENSION && value <= MAX_DIMENSION
}

export function parsePluginPanelSizes(raw: unknown): Map<string, PluginPanelSize> {
  const sizes = new Map<string, PluginPanelSize>()
  if (!isRecord(raw) || raw.version !== PLUGIN_PANEL_SIZES_VERSION || !isRecord(raw.sizes)) return sizes
  for (const [pluginId, value] of Object.entries(raw.sizes)) {
    if (sizes.size >= MAX_ENTRIES) break
    if (!PLUGIN_ID.test(pluginId) || !isRecord(value) || !validDimension(value.width) || !validDimension(value.height)) continue
    sizes.set(pluginId, { width: Math.round(value.width), height: Math.round(value.height) })
  }
  return sizes
}

export function serializePluginPanelSizes(sizes: ReadonlyMap<string, PluginPanelSize>): { version: number; sizes: Record<string, PluginPanelSize> } {
  const entries: Record<string, PluginPanelSize> = {}
  for (const [pluginId, size] of [...sizes].slice(-MAX_ENTRIES)) {
    if (PLUGIN_ID.test(pluginId)) entries[pluginId] = { width: size.width, height: size.height }
  }
  return { version: PLUGIN_PANEL_SIZES_VERSION, sizes: entries }
}

export class PluginPanelSizeStore {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: ReadonlyMap<string, PluginPanelSize> | null = null

  private readonly filePath: string
  private readonly debounceMs: number

  constructor(filePath: string, debounceMs = 800) {
    this.filePath = filePath
    this.debounceMs = debounceMs
  }

  load(): Map<string, PluginPanelSize> {
    try {
      return parsePluginPanelSizes(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch {
      return new Map()
    }
  }

  // 拖曳視窗邊緣會連續觸發，合併寫入。
  save(sizes: ReadonlyMap<string, PluginPanelSize>): void {
    this.pending = new Map(sizes)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const pending = this.pending
    this.pending = null
    if (!pending) return
    try {
      writeJsonAtomic(this.filePath, serializePluginPanelSizes(pending))
    } catch {
      // 尺寸記憶是便利功能，寫入失敗不影響插件運作。
    }
  }
}
