import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { LocalServerHealthSnapshot, LocalServerId } from '../../src/types/reliability.ts'
import { IPC_CHANNELS } from './channels.ts'

export interface ReliabilityIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getServerHealth(): LocalServerHealthSnapshot
  retryServer(id?: LocalServerId): void
}

const SERVER_IDS: readonly LocalServerId[] = ['event', 'permission', 'presentation']

export function registerReliabilityIpc(deps: ReliabilityIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.serverHealthGet, (event): LocalServerHealthSnapshot => {
    deps.assertTrustedIpcSender(event)
    return deps.getServerHealth()
  })

  deps.ipcMain.handle(IPC_CHANNELS.serverHealthRetry, (event, id: unknown): LocalServerHealthSnapshot => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    deps.retryServer(SERVER_IDS.includes(id as LocalServerId) ? id as LocalServerId : undefined)
    return deps.getServerHealth()
  })
}
