/// <reference types="vite/client" />

import type { DesktopPreferences, DesktopPreferencesPatch } from './types/desktop'
import type { PermissionDecisionValue, PermissionRequestStatus, PermissionRequestView } from './types/permission'
import type { ProgressionSnapshot } from './types/progression'
import type { PetWindowMode, PetWindowModeState } from './types/pet-window'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    electronAPI?: {
      onAgentStatusEvent: (callback: (event: any) => void) => () => void
      startDrag: () => void
      notifyDragEnd: (moved: boolean) => void
      notifyPetHover: () => void
      setPetWindowMode: (mode: PetWindowMode) => Promise<PetWindowModeState>
      initializePetWindowMode: () => Promise<PetWindowModeState>
      onPetWindowModeUpdated: (callback: (state: PetWindowModeState) => void) => () => void
      resizeWindow: (width: number, height: number) => void
      reportContentHeight: (height: number) => void
      setMousePassthrough: (ignore: boolean) => void
      togglePanel: () => void
      resizePanel: (height: number) => void
      hidePanel: () => void
      onPanelOpened: (callback: () => void) => () => void
      onPanelOpenSettings: (callback: () => void) => () => void
      initializeDesktopPreferences: (legacySoundEnabled: boolean) => Promise<DesktopPreferences>
      setDesktopPreferences: (patch: DesktopPreferencesPatch) => Promise<DesktopPreferences>
      initializeProgression: (petId?: string) => Promise<ProgressionSnapshot | null>
      setProgressionPet: (petId: string) => Promise<ProgressionSnapshot | null>
      onProgressionUpdated: (callback: (snapshot: ProgressionSnapshot) => void) => () => void
      onDesktopPreferencesUpdated: (callback: (preferences: DesktopPreferences) => void) => () => void
      initializePermissionRequests: () => Promise<PermissionRequestView[]>
      onPermissionRequestsUpdated: (callback: (requests: PermissionRequestView[]) => void) => () => void
      decidePermission: (
        requestId: string,
        decision: PermissionDecisionValue,
      ) => Promise<{
        ok: boolean
        status?: PermissionRequestStatus
        error?: 'not_found' | 'invalid_decision' | 'conflict'
      }>
      quitApp: () => void
      restartApp: () => void
      checkIntegration: () => Promise<{
        opencode: { cli: boolean; desktop: boolean }
        codex: { hooks: boolean; enabled: boolean; configured: boolean; hookScript: boolean }
        claude: { config: boolean; hookScript: boolean }
        claudeCode: { settings: boolean; configured: boolean; hookScript: boolean }
      }>
      getQuotaUsage: (force?: boolean) => Promise<{
        updatedAt: string
        providers: Array<{
          id: 'codex' | 'claude'
          name: string
          plan?: string
          windows: Array<{
            id: string
            label: string
            usedPercent: number
            remainingPercent: number
            resetsAt?: string
          }>
          error?: string
        }>
      }>
      onQuotaUsageUpdated: (callback: (usage: unknown) => void) => () => void
      testIntegration: (source: 'opencode-cli' | 'opencode-desktop' | 'codex' | 'claude' | 'claude-desktop') => Promise<{
        ok: boolean
        verifiedAt?: number
        error?: string
      }>
      installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
      uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
      loadPets: () => Promise<Array<{ id: string; displayName: string; folder: string; builtIn: boolean }>>
      addCustomPet: (petData: { id: string; displayName: string }) => Promise<boolean>
      renameCustomPet: (petId: string, newName: string) => Promise<boolean>
      removeCustomPet: (petId: string) => Promise<boolean>
      getCustomPetSprite: (petId: string) => Promise<string | null>
      importPetSprite: (petId: string, displayName: string) => Promise<string | null>
      importPetZip: () => Promise<{ ok: boolean; id?: string; displayName?: string; error?: string }>
    }
  }
}
