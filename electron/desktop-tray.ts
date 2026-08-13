import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { PetWindowMode } from '../src/types/pet-window'
import { createAttentionBitmap } from './tray-icon'
import { t } from '../src/i18n'

interface DesktopTrayActions {
  getPreferences: () => DesktopPreferences
  updatePreferences: (patch: DesktopPreferencesPatch) => void
  isPetVisible: () => boolean
  showPet: () => void
  hidePet: () => void
  openPanel: () => void
  openSettings: () => void
  getPetMode: () => PetWindowMode
  toggleMiniMode: () => void
  quit: () => void
}

export class DesktopTrayController {
  private readonly iconPath: string
  private readonly actions: DesktopTrayActions
  private tray: Tray | null = null
  private baseIcon: NativeImage | null = null
  private attentionIcon: NativeImage | null = null
  private attentionCount = 0

  constructor(iconPath: string, actions: DesktopTrayActions) {
    this.iconPath = iconPath
    this.actions = actions
  }

  create(): void {
    if (this.tray) return
    const source = nativeImage.createFromPath(this.iconPath)
    if (source.isEmpty()) throw new Error(`Tray icon not found: ${this.iconPath}`)
    const size = process.platform === 'win32' ? 16 : 18
    this.baseIcon = source.resize({ width: size, height: size })
    try {
      this.attentionIcon = nativeImage.createFromBitmap(
        createAttentionBitmap(this.baseIcon.toBitmap(), size, size),
        { width: size, height: size, scaleFactor: 1 },
      )
      if (this.attentionIcon.isEmpty()) this.attentionIcon = null
    } catch {
      this.attentionIcon = null
    }
    this.tray = new Tray(this.baseIcon)
    this.tray.on('click', () => this.actions.showPet())
    this.rebuild()
  }

  rebuild(): void {
    if (!this.tray) return
    const preferences = this.actions.getPreferences()
    const visible = this.actions.isPetVisible()
    const attentionLabel = this.attentionCount > 0
      ? t('needsAttention', { count: this.attentionCount })
      : t('noPendingAttention')

    if (this.baseIcon) {
      this.tray.setImage(this.attentionCount > 0 && this.attentionIcon
        ? this.attentionIcon
        : this.baseIcon)
    }

    const tooltipParts = [t('appName')]
    if (preferences.dndEnabled) tooltipParts.push(t('dnd'))
    if (this.attentionCount > 0) tooltipParts.push(t('pendingCount', { count: this.attentionCount }))
    this.tray.setToolTip(tooltipParts.join(' · '))

    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: visible ? t('hidePets') : t('showPets'),
        click: () => visible ? this.actions.hidePet() : this.actions.showPet(),
      },
      { label: t('openControlPanel'), click: () => this.actions.openPanel() },
      { label: t('openSettings'), click: () => this.actions.openSettings() },
      {
        label: t('miniMode'),
        type: 'checkbox',
        checked: this.actions.getPetMode() === 'mini',
        click: () => this.safeToggleMiniMode(),
      },
      {
        label: t('edgePeekMode'),
        type: 'checkbox',
        checked: preferences.edgeModeEnabled,
        click: item => this.safeUpdatePreferences({ edgeModeEnabled: item.checked }),
      },
      { label: attentionLabel, enabled: false },
      { type: 'separator' },
      {
        label: t('dnd'),
        type: 'checkbox',
        checked: preferences.dndEnabled,
        click: item => this.safeUpdatePreferences({ dndEnabled: item.checked }),
      },
      {
        label: t('sound'),
        type: 'checkbox',
        checked: preferences.soundEnabled,
        click: item => this.safeUpdatePreferences({ soundEnabled: item.checked }),
      },
      {
        label: t('notifications'),
        type: 'checkbox',
        checked: preferences.notificationsEnabled,
        click: item => this.safeUpdatePreferences({ notificationsEnabled: item.checked }),
      },
      {
        label: t('permissionBubble'),
        type: 'checkbox',
        checked: preferences.permissionBubbleEnabled,
        click: item => this.safeUpdatePreferences({ permissionBubbleEnabled: item.checked }),
      },
      {
        label: 'Presentation MCP',
        type: 'checkbox',
        checked: preferences.presentationMcpEnabled,
        click: item => this.safeUpdatePreferences({ presentationMcpEnabled: item.checked }),
      },
      {
        label: t('launchAtStartup'),
        type: 'checkbox',
        checked: preferences.launchAtStartup,
        enabled: preferences.launchAtStartupSupported,
        click: item => this.safeUpdatePreferences({ launchAtStartup: item.checked }),
      },
      { type: 'separator' },
      { label: t('checkUpdates'), enabled: false },
      { type: 'separator' },
      { label: t('quit'), click: () => this.actions.quit() },
    ]))
  }

  setAttentionCount(count: number): void {
    this.attentionCount = Math.max(0, Math.floor(count))
    this.rebuild()
  }

  private safeUpdatePreferences(patch: DesktopPreferencesPatch): void {
    try {
      this.actions.updatePreferences(patch)
    } catch (error) {
      console.error('Failed to update desktop preferences from Tray', error)
      this.rebuild()
    }
  }

  private safeToggleMiniMode(): void {
    try {
      this.actions.toggleMiniMode()
    } catch (error) {
      console.error('Failed to toggle Mini Mode from Tray', error)
      this.rebuild()
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
    this.baseIcon = null
    this.attentionIcon = null
  }
}
