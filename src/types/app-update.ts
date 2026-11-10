// App 新版檢查的 renderer／main 共用型別。renderer 只拿到這份快照；release 頁網址只存在主程序。
export type AppUpdateResult = 'up_to_date' | 'update_available' | 'failed'

export interface AppUpdateState {
  currentVersion: string
  enabled: boolean
  lastCheckedAt: number | null
  lastResult: AppUpdateResult | null
  /** 只在 lastResult 為 update_available 時有值。 */
  latestVersion: string | null
}

export type AppUpdateCheckOutcome = 'done' | 'rate_limited' | 'in_progress'

export interface AppUpdateCheckResponse {
  state: AppUpdateState
  outcome: AppUpdateCheckOutcome
}

/** renderer 端額外顯示的一次性提示。 */
export type AppUpdateOutcomeView = 'rate_limited' | 'open_failed'
