import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PanelThemeMode, PanelThemeRef, PanelThemeState, PanelThemeStoredUserImage, PetStatusThemeState } from '../../src/types/panel-theme.ts'
import { isPanelThemeMode } from '../../src/types/panel-theme.ts'
import type { PanelThemeSourcePlugin } from '../plugin-panel-themes.ts'
import type { PanelThemeStore } from '../panel-theme-store.ts'
import { isPanelThemeRef, isPanelThemeUserImageOptions } from '../panel-theme-store.ts'
import type { UserImagePrepared, UserImageReadError } from '../panel-theme-images.ts'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

type DialogOptions = {
  title: string
  filters: Array<{ name: string; extensions: string[] }>
  properties: Array<'openFile'>
}
type FilePickerResult = { canceled: boolean; filePaths: string[] }
type PreparedImage = Extract<UserImagePrepared, { ok: true }>

export interface PanelThemeIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertPluginPanelSender(event: IpcMainInvokeEvent): void
  /** Pet window main frame only (the pill is the one themed pet surface). */
  assertPetSender(event: IpcMainInvokeEvent): void
  getPetStatus(): PetStatusThemeState
  getStore(): PanelThemeStore | null
  /** Plugins that currently contribute themes (installed; `available` = enabled and global switch on). */
  getSources(): readonly PanelThemeSourcePlugin[]
  getState(): PanelThemeState
  /** Rebuilds the token map and sends `panel-theme-changed` when the state changed. */
  publish(): void
  getPanelWindow(): BrowserWindow | null
  isDialogOpen(): boolean
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: DialogOptions): Promise<FilePickerResult>
  translate(key: 'design.panelTheme.image.dialogTitle'): string
  readUserImage(filePath: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: UserImageReadError }>
  prepareUserImage(bytes: Uint8Array): UserImagePrepared
  storeUserImage(pluginId: string, prepared: PreparedImage): void
  deleteUserImage(pluginId: string, file: string): void
  pluginPanelError(error: unknown): string
  now(): number
}

function availableMode(sources: readonly PanelThemeSourcePlugin[], ref: PanelThemeRef, mode: PanelThemeMode) {
  const source = sources.find(candidate => candidate.pluginId === ref.pluginId)
  if (!source?.available) return null
  return source.themes.find(theme => theme.id === ref.themeId)?.modes[mode] ?? null
}

function isReferenced(store: PanelThemeStore, pluginId: string, file: string): boolean {
  return store.referencedFiles().has(`${pluginId}/${file}`)
}

export function registerPanelThemeIpc(deps: PanelThemeIpcDependencies): void {
  const stateResult = () => ({ ok: true as const, value: deps.getState() })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeStateGet, deps.assertPluginPanelSender, () => stateResult())

  // No payload: the pet window only reads the resolved pill colours.
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemePetStatusGet, deps.assertPetSender, () => deps.getPetStatus())

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeSlotSet, deps.assertPluginPanelSender, (_event, mode: unknown, ref: unknown) => {
    const store = deps.getStore()
    if (!store) return { ok: false, error: 'plugin_service_unavailable' }
    if (!isPanelThemeMode(mode) || (ref !== null && !isPanelThemeRef(ref))) return { ok: false, error: 'invalid_request' }
    if (ref !== null && !availableMode(deps.getSources(), ref, mode)) return { ok: false, error: 'theme_unavailable' }
    try {
      store.setSlot(mode, ref)
    } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
    deps.publish()
    return stateResult()
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserImageImport, deps.assertPluginPanelSender, async (_event, ref: unknown, mode: unknown) => {
    const store = deps.getStore()
    const panelWindow = deps.getPanelWindow()
    if (!store || !panelWindow || panelWindow.isDestroyed()) return { ok: false, error: 'plugin_service_unavailable' }
    if (!isPanelThemeRef(ref) || !isPanelThemeMode(mode)) return { ok: false, error: 'invalid_request' }
    const resolved = availableMode(deps.getSources(), ref, mode)
    if (!resolved) return { ok: false, error: 'theme_unavailable' }
    if (!resolved.userImage) return { ok: false, error: 'image_not_allowed' }
    if (deps.isDialogOpen()) return { ok: false, error: 'dialog_unavailable' }
    deps.setDialogOpen(true)
    let selection: FilePickerResult
    try {
      selection = await deps.showOpenDialog(panelWindow, {
        title: deps.translate('design.panelTheme.image.dialogTitle'),
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile'],
      })
    } catch {
      return { ok: false, error: 'dialog_unavailable' }
    } finally {
      deps.setDialogOpen(false)
    }
    if (selection.canceled || selection.filePaths.length === 0 || typeof selection.filePaths[0] !== 'string') {
      return { ok: false, error: 'cancelled', cancelled: true }
    }
    const read = await deps.readUserImage(selection.filePaths[0])
    if (!read.ok) return { ok: false, error: read.error }
    const prepared = deps.prepareUserImage(read.bytes)
    if (!prepared.ok) return { ok: false, error: prepared.error, ...(prepared.reason ? { reason: prepared.reason } : {}) }
    // The theme may have changed while the dialog was open.
    const current = availableMode(deps.getSources(), ref, mode)
    if (!current?.userImage) return { ok: false, error: 'theme_unavailable' }
    const previous = store.getUserImage(ref, mode)
    const dim = previous && previous.dim >= current.userImage.minDim ? previous.dim : current.userImage.defaultDim
    const entry: PanelThemeStoredUserImage = {
      file: prepared.file,
      type: prepared.type,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.bytes.byteLength,
      fit: previous?.fit ?? current.userImage.fit,
      position: previous?.position ?? 'center',
      dim,
      blur: previous?.blur ?? 0,
      importedAt: new Date(deps.now()).toISOString(),
    }
    try {
      deps.storeUserImage(ref.pluginId, prepared)
    } catch {
      return { ok: false, error: 'write_failed' }
    }
    let replaced: string | null
    try {
      replaced = store.setUserImage(ref, mode, entry)
    } catch (error) {
      if (!isReferenced(store, ref.pluginId, prepared.file)) deps.deleteUserImage(ref.pluginId, prepared.file)
      return { ok: false, error: error instanceof RangeError ? 'write_failed' : deps.pluginPanelError(error) }
    }
    if (replaced && !isReferenced(store, ref.pluginId, replaced)) deps.deleteUserImage(ref.pluginId, replaced)
    deps.publish()
    return stateResult()
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserImageClear, deps.assertPluginPanelSender, (_event, ref: unknown, mode: unknown) => {
    const store = deps.getStore()
    if (!store) return { ok: false, error: 'plugin_service_unavailable' }
    if (!isPanelThemeRef(ref) || !isPanelThemeMode(mode)) return { ok: false, error: 'invalid_request' }
    if (!availableMode(deps.getSources(), ref, mode)) return { ok: false, error: 'theme_unavailable' }
    let file: string | null
    try {
      file = store.clearUserImage(ref, mode)
    } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
    if (file && !isReferenced(store, ref.pluginId, file)) deps.deleteUserImage(ref.pluginId, file)
    deps.publish()
    return stateResult()
  })

  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.panelThemeUserImageOptionsSet, deps.assertPluginPanelSender, (_event, ref: unknown, mode: unknown, options: unknown) => {
    const store = deps.getStore()
    if (!store) return { ok: false, error: 'plugin_service_unavailable' }
    if (!isPanelThemeRef(ref) || !isPanelThemeMode(mode)) return { ok: false, error: 'invalid_request' }
    const resolved = availableMode(deps.getSources(), ref, mode)
    if (!resolved) return { ok: false, error: 'theme_unavailable' }
    if (!resolved.userImage) return { ok: false, error: 'image_not_allowed' }
    // Reject, never clamp: dim below the computed minimum is invalid.
    if (!isPanelThemeUserImageOptions(options, resolved.userImage.minDim)) return { ok: false, error: 'invalid_request' }
    try {
      if (!store.updateUserImageOptions(ref, mode, options)) return { ok: false, error: 'invalid_request' }
    } catch (error) {
      return { ok: false, error: deps.pluginPanelError(error) }
    }
    deps.publish()
    return stateResult()
  })
}
