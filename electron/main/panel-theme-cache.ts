import { createHash } from 'node:crypto'
import { resolvePanelThemes, type ResolvedPanelTheme } from '../plugin-panel-themes.ts'

// 解析後主題的快取（spec §16.5「validation cached by theme hash」）。鍵是宣告內容的
// SHA-256（鍵排序後的 JSON），所以同版本號下內容改變（開發者資料夾重新載入）一定重新驗證，
// 內容相同的插件更新則直接命中。容量有上限（LRU），sync 時再把已移除插件的項目丟掉。

/** 預設容量：遠大於一般安裝量，但讓惡意或異常的大量插件無法讓快取無限成長。 */
export const PANEL_THEME_CACHE_MAX_ENTRIES = 32

type Resolve = (declared: unknown) => ResolvedPanelTheme[] | null

/** 鍵排序後的 JSON：同樣的內容不論屬性順序都得到同一個字串。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function panelThemeContentHash(declared: unknown): string {
  return createHash('sha256').update(canonicalJson(declared), 'utf8').digest('hex')
}

export class PanelThemeResolveCache {
  private readonly entries = new Map<string, ResolvedPanelTheme[] | null>()
  // 同一份 manifest 物件在多次 sync 之間不變：記住它的雜湊，不必每次重新序列化。
  private readonly hashes = new WeakMap<object, string>()
  private readonly maxEntries: number
  private readonly resolve: Resolve
  private hitCount = 0
  private missCount = 0

  constructor(options: { maxEntries?: number; resolve?: Resolve } = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? PANEL_THEME_CACHE_MAX_ENTRIES)
    this.resolve = options.resolve ?? resolvePanelThemes
  }

  keyOf(declared: unknown): string {
    if (!declared || typeof declared !== 'object') return panelThemeContentHash(declared)
    const known = this.hashes.get(declared)
    if (known) return known
    const hash = panelThemeContentHash(declared)
    this.hashes.set(declared, hash)
    return hash
  }

  /** 回傳解析結果與它的鍵；未命中時驗證一次並存入（最近使用的排在最後）。 */
  get(declared: unknown): { key: string; themes: ResolvedPanelTheme[] | null } {
    const key = this.keyOf(declared)
    if (this.entries.has(key)) {
      const themes = this.entries.get(key)!
      this.entries.delete(key)
      this.entries.set(key, themes)
      this.hitCount += 1
      return { key, themes }
    }
    this.missCount += 1
    const themes = this.resolve(declared)
    this.entries.set(key, themes)
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
    return { key, themes }
  }

  /** 只依鍵取值（插件暫時沒有 manifest 時沿用最後一次的結果），不改變使用順序。 */
  peek(key: string): ResolvedPanelTheme[] | null | undefined {
    return this.entries.get(key)
  }

  /** 丟掉不在 `live` 裡的項目（插件移除或更新成不同內容後）。 */
  retain(live: ReadonlySet<string>): void {
    for (const key of [...this.entries.keys()]) if (!live.has(key)) this.entries.delete(key)
  }

  get size(): number {
    return this.entries.size
  }

  get stats(): { hits: number; misses: number } {
    return { hits: this.hitCount, misses: this.missCount }
  }
}
