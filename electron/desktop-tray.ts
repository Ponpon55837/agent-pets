import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { DesktopPreferences, DesktopPreferencesPatch } from '../src/types/desktop'
import type { PetWindowMode } from '../src/types/pet-window'
import { createAttentionBitmap } from './tray-icon'

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
      ? `Needs attention (${this.attentionCount})`
      : 'No pending attention'

    if (this.baseIcon) {
      this.tray.setImage(this.attentionCount > 0 && this.attentionIcon
        ? this.attentionIcon
        : this.baseIcon)
    }

    this.tray.setToolTip([
      'Agent Pets',
      preferences.dndEnabled ? 'Do Not Disturb' : '',
      this.attentionCount > 0 ? `${this.attentionCount} pending` : '',
    ].filter(Boolean).join(' · '))

    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: visible ? 'Hide Pets' : 'Show Pets',
        click: () => visible ? this.actions.hidePet() : this.actions.showPet(),
      },
      { label: 'Open Control Panel', click: () => this.actions.openPanel() },
      { label: 'Open Settings', click: () => this.actions.openSettings() },
      {
        label: 'Mini Mode',
        type: 'checkbox',
        checked: this.actions.getPetMode() === 'mini',
        click: () => this.safeToggleMiniMode(),
      },
      {
        label: 'Edge Peek Mode',
        type: 'checkbox',
        checked: preferences.edgeModeEnabled,
        click: item => this.safeUpdatePreferences({ edgeModeEnabled: item.checked }),
      },
      { label: attentionLabel, enabled: false },
      { type: 'separator' },
      {
        label: 'Do Not Disturb',
        type: 'checkbox',
        checked: preferences.dndEnabled,
        click: item => this.safeUpdatePreferences({ dndEnabled: item.checked }),
      },
      {
        label: 'Sound',
        type: 'checkbox',
        checked: preferences.soundEnabled,
        click: item => this.safeUpdatePreferences({ soundEnabled: item.checked }),
      },
      {
        label: 'Notifications',
        type: 'checkbox',
        checked: preferences.notificationsEnabled,
        click: item => this.safeUpdatePreferences({ notificationsEnabled: item.checked }),
      },
      {
        label: 'Permission Bubble',
        type: 'checkbox',
        checked: preferences.permissionBubbleEnabled,
        click: item => this.safeUpdatePreferences({ permissionBubbleEnabled: item.checked }),
      },
      {
        label: 'Launch at Startup',
        type: 'checkbox',
        checked: preferences.launchAtStartup,
        enabled: preferences.launchAtStartupSupported,
        click: item => this.safeUpdatePreferences({ launchAtStartup: item.checked }),
      },
      { type: 'separator' },
      { label: 'Check for Updates (not available yet)', enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => this.actions.quit() },
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
