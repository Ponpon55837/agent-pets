import type { DbMaintenanceResult } from '../../src/types/growth-maintenance.ts'
import { SqliteBusyError, sqliteFootprintBytes } from '../sqlite-maintenance.ts'

// 資料庫整理：沿用既有保留期清理（history 的 pruneInBatches、progression 的 pruneStaleActivity、
// 成就的本機 token 去重列壓縮），再對三個資料庫各做 optimize + VACUUM。只由使用者觸發；
// 啟動流程不呼叫它，所以不會拖慢開機。

const DAY_MS = 24 * 60 * 60 * 1000

interface HistoryMaintenanceStore {
  getRetentionDays(): number
  pruneInBatches(): Promise<{ events: number, sessions: number }>
  compact(): void
}
interface ProgressionMaintenanceStore {
  pruneStaleActivity(maxAgeMs?: number, limit?: number): number
  compact(): void
}
interface AchievementMaintenanceStore {
  compactLocalTokenUsage(before: number): number
  compact(): void
}

export interface DbMaintenanceDeps {
  getHistoryStore(): HistoryMaintenanceStore | null
  getProgressionStore(): ProgressionMaintenanceStore | null
  getAchievementStore(): AchievementMaintenanceStore | null
  /** 三個資料庫檔的路徑，用來量整理前後的磁碟占用。 */
  databasePaths(): readonly string[]
  /** 本機用量掃描是否進行中（掃描以多批交易匯入，不能和 VACUUM 交錯）。 */
  isLocalScanActive(): boolean
  logError(message: string, error?: unknown): void
  now?: () => number
  footprint?: (filePath: string) => number
}

export interface DbMaintenanceService {
  run(): Promise<DbMaintenanceResult>
}

export function createDbMaintenanceService(deps: DbMaintenanceDeps): DbMaintenanceService {
  const now = deps.now ?? (() => Date.now())
  const footprint = deps.footprint ?? sqliteFootprintBytes
  let running = false

  const totalBytes = () => deps.databasePaths().reduce((sum, path) => sum + footprint(path), 0)

  async function run(): Promise<DbMaintenanceResult> {
    // 重入防護：同時只允許一個整理工作。
    if (running) return { ok: false, error: 'busy' }
    const history = deps.getHistoryStore()
    const progression = deps.getProgressionStore()
    const achievements = deps.getAchievementStore()
    if (!history && !progression && !achievements) return { ok: false, error: 'unavailable' }
    if (deps.isLocalScanActive()) return { ok: false, error: 'scanning' }
    running = true
    try {
      const beforeBytes = totalBytes()
      let prunedRows = 0
      try {
        if (history) {
          const pruned = await history.pruneInBatches()
          prunedRows += pruned.events + pruned.sessions
        }
        if (progression) {
          for (;;) {
            const step = progression.pruneStaleActivity()
            prunedRows += step
            if (step < 5000) break
          }
        }
        if (achievements) {
          const retentionDays = history?.getRetentionDays() ?? 90
          prunedRows += achievements.compactLocalTokenUsage(now() - (retentionDays + 1) * DAY_MS)
        }
        // 清理過程讓出過事件迴圈，掃描可能在期間啟動；VACUUM 前重查一次，之後到結束都是同步的。
        if (deps.isLocalScanActive()) return { ok: false, error: 'scanning' }
        for (const store of [history, progression, achievements]) store?.compact()
      } catch (error) {
        if (error instanceof SqliteBusyError) return { ok: false, error: 'busy' }
        deps.logError('Database maintenance failed', error)
        return { ok: false, error: 'failed' }
      }
      const afterBytes = totalBytes()
      return { ok: true, beforeBytes, afterBytes, freedBytes: Math.max(0, beforeBytes - afterBytes), prunedRows }
    } finally {
      running = false
    }
  }

  return { run }
}
