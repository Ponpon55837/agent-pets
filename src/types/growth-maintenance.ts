/** 設定頁「重設成長資料」與「資料庫整理」兩個維護操作的共用契約。 */

/** 重設 IPC 唯一接受的確認字面值；renderer 必須先經過確認對話框才會送出。 */
export const GROWTH_RESET_CONFIRMATION = 'reset-growth'

export type GrowthResetResult =
  | { ok: true }
  | { ok: false, error: 'unavailable' | 'rate_limited' | 'invalid_request' | 'failed' }

export interface DbMaintenanceSuccess {
  ok: true
  /** 整理前後的磁碟占用（資料庫檔 + -wal 檔，三個資料庫加總）。 */
  beforeBytes: number
  afterBytes: number
  freedBytes: number
  /** 保留期清理刪掉的歷史／活動／帳本列數。 */
  prunedRows: number
}

export type DbMaintenanceResult =
  | DbMaintenanceSuccess
  | { ok: false, error: 'busy' | 'scanning' | 'unavailable' | 'rate_limited' | 'failed' }
