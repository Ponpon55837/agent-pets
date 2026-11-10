import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  GROWTH_RESET_CONFIRMATION,
  type DbMaintenanceResult,
  type GrowthResetResult,
} from '../../src/types/growth-maintenance.ts'
import { IPC_CHANNELS } from './channels.ts'
import { handleTrusted } from './trusted.ts'

// 這兩個操作都是破壞性或長時間的，所以：只允許設定面板視窗、固定間隔內只受理一次。
export const GROWTH_RESET_MIN_INTERVAL_MS = 5_000
export const DB_MAINTENANCE_MIN_INTERVAL_MS = 10_000

export interface GrowthMaintenanceIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  resetGrowth(): GrowthResetResult
  runDbMaintenance(): Promise<DbMaintenanceResult>
  now?: () => number
}

export function registerGrowthMaintenanceIpc(deps: GrowthMaintenanceIpcDependencies): void {
  const now = deps.now ?? (() => Date.now())
  let lastResetAt = Number.NEGATIVE_INFINITY
  let lastMaintenanceAt = Number.NEGATIVE_INFINITY

  handleTrusted(deps.ipcMain, IPC_CHANNELS.growthReset, deps.getPanelWindow, deps.assertTrustedIpcSender, (_event, confirmation?: unknown): GrowthResetResult => {
    // 固定的確認字面值：renderer 的確認對話框通過後才會帶它，任何其他值一律拒絕。
    if (confirmation !== GROWTH_RESET_CONFIRMATION) return { ok: false, error: 'invalid_request' }
    const at = now()
    if (at - lastResetAt < GROWTH_RESET_MIN_INTERVAL_MS) return { ok: false, error: 'rate_limited' }
    lastResetAt = at
    return deps.resetGrowth()
  })

  handleTrusted(deps.ipcMain, IPC_CHANNELS.dbMaintenanceRun, deps.getPanelWindow, deps.assertTrustedIpcSender, async (): Promise<DbMaintenanceResult> => {
    const at = now()
    if (at - lastMaintenanceAt < DB_MAINTENANCE_MIN_INTERVAL_MS) return { ok: false, error: 'rate_limited' }
    lastMaintenanceAt = at
    return deps.runDbMaintenance()
  })
}
