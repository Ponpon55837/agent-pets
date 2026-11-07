import assert from 'node:assert/strict'
import test from 'node:test'
import { IPC_CHANNELS } from '../electron/ipc/channels.ts'
import { registerHistoryIpc } from '../electron/ipc/history.ts'

function createHistoryIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const panelWindow = { id: 'panel' }
  const records = { trusted: [] as Array<unknown>, broadcasts: 0, refreshes: 0, writes: [] as Array<{ path: string; value: unknown }> }
  let dialogResult: { canceled: boolean; filePath?: string } = { canceled: true }
  const historyStore = {
    clear() {},
    getExport: (petId: string) => ({ petId, rows: [] }),
  }

  registerHistoryIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    assertTrustedIpcSender: (event: unknown, requiredWindow: unknown) => records.trusted.push({ event, requiredWindow }),
    getPanelWindow: () => panelWindow,
    getHistoryStore: () => historyStore,
    refreshLocalUsage: async () => { records.refreshes += 1 },
    currentHistorySummary: (projectId, rangeDays) => ({ projectId: projectId ?? null, rangeDays }),
    broadcastHistoryUpdated: () => { records.broadcasts += 1 },
    documentsPath: () => 'test-documents',
    joinPath: (...parts: string[]) => parts.join('/'),
    showSaveDialog: async (window: unknown, options: unknown) => {
      records.trusted.push({ dialogWindow: window, options })
      return dialogResult
    },
    writeJsonAtomic: (path: string, value: unknown) => records.writes.push({ path, value }),
    activePetId: () => 'sample-pet',
  })

  return {
    handlers,
    panelWindow,
    records,
    setDialogResult(value: { canceled: boolean; filePath?: string }) { dialogResult = value },
  }
}

test('history IPC registration uses injected services and preserves handler behavior', async () => {
  const harness = createHistoryIpcHarness()
  const invoke = (channel: string, ...args: unknown[]) => harness.handlers.get(channel)?.({}, ...args)

  assert.deepEqual([...harness.handlers.keys()], [
    IPC_CHANNELS.historySummary,
    IPC_CHANNELS.historyClear,
    IPC_CHANNELS.historyExport,
  ])
  assert.deepEqual(await invoke(IPC_CHANNELS.historySummary, 'project-a'), { projectId: 'project-a', rangeDays: 7 })
  assert.deepEqual(await invoke(IPC_CHANNELS.historySummary, 7), { projectId: null, rangeDays: 7 })
  assert.equal(harness.records.refreshes, 2)

  assert.deepEqual(await invoke(IPC_CHANNELS.historyClear), { ok: true })
  assert.equal(harness.records.broadcasts, 1)

  assert.deepEqual(await invoke(IPC_CHANNELS.historyExport), { ok: false, error: 'cancelled' })
  assert.deepEqual(harness.records.writes, [])
  harness.setDialogResult({ canceled: false, filePath: 'test-documents/history.json' })
  assert.deepEqual(await invoke(IPC_CHANNELS.historyExport), { ok: true, path: 'test-documents/history.json' })
  assert.deepEqual(harness.records.writes, [
    { path: 'test-documents/history.json', value: { petId: 'sample-pet', rows: [] } },
  ])
  assert.equal(harness.records.refreshes, 4)
  assert.equal(harness.records.trusted.length, 7)
})

test('history summary range is limited to the supported 7/30/90 windows', async () => {
  const harness = createHistoryIpcHarness()
  const invoke = (...args: unknown[]) => harness.handlers.get(IPC_CHANNELS.historySummary)?.({}, ...args) as Promise<{ rangeDays: number }>
  assert.equal((await invoke(undefined, 30)).rangeDays, 30)
  assert.equal((await invoke(undefined, 90)).rangeDays, 90)
  assert.equal((await invoke(undefined, 365)).rangeDays, 7)
  assert.equal((await invoke(undefined, '30')).rangeDays, 7)
})
