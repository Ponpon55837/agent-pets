/// <reference types="vite/client" />

import type { DesktopPreferences, DesktopPreferencesPatch } from '@/types/desktop'
import type { PermissionDecisionValue, PermissionRequestStatus, PermissionRequestView } from '@/types/permission'
import type { ProgressionSnapshot } from '@/types/progression'
import type { AchievementSnapshot, AchievementUnlock } from '@/types/achievement'
import type { HistoryClearResult, HistoryCommandResult, HistorySummary } from '@/types/history'
import type { PetWindowMode, PetWindowModeState } from '@/types/pet-window'
import type { PetBehaviorManifest } from '@/types/pet'
import type {
  AdapterDetection,
  AdapterRuntimeStatus,
  AgentAdapterId,
  DiagnosticReport,
} from '@/types/agent-adapter'
import type { PresentationIntent, PresentationStatusUpdate } from '@/types/presentation'
import type {
  ProjectMcpRegistrySnapshot,
  ProjectMcpRemovalSummary,
  ProjectMcpSetupSummary,
} from '@/types/project-mcp'
import type { ProjectPetArchiveResult, ProjectPetCommandResult, ProjectPetView } from '@/types/project-pet'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    electronAPI?: {
      onAgentStatusEvent: (callback: (event: any) => void) => () => void
      onPresentationIntent: (callback: (intent: PresentationIntent) => void) => () => void
      publishPresentationStatus: (snapshot: PresentationStatusUpdate) => void
      startDrag: () => void
      notifyDragEnd: (moved: boolean) => void
      notifyPetHover: () => void
      shimejiWalkStep: (deltaX: number) => void
      setPetWindowMode: (mode: PetWindowMode) => Promise<PetWindowModeState>
      initializePetWindowMode: () => Promise<PetWindowModeState>
      onPetWindowModeUpdated: (callback: (state: PetWindowModeState) => void) => () => void
      resizeWindow: (width: number, height: number) => void
      reportContentHeight: (height: number) => void
      setMousePassthrough: (ignore: boolean) => void
      togglePanel: () => void
      resizePanel: (height: number, width?: number) => void
      hidePanel: () => void
      onPanelOpened: (callback: () => void) => () => void
      onPanelOpenSettings: (callback: () => void) => () => void
      initializeDesktopPreferences: (legacySoundEnabled: boolean) => Promise<DesktopPreferences>
      setDesktopPreferences: (patch: DesktopPreferencesPatch) => Promise<DesktopPreferences>
      getPowerSaveState: () => Promise<boolean>
      onPowerSaveStateUpdated: (callback: (powerSave: boolean) => void) => () => void
      initializeProgression: (petId?: string) => Promise<ProgressionSnapshot | null>
      setProgressionPet: (petId: string) => Promise<ProgressionSnapshot | null>
      initializeAchievements: (petId?: string) => Promise<AchievementSnapshot | null>
      onAchievementsUpdated: (callback: (snapshot: AchievementSnapshot) => void) => () => void
      onAchievementUnlocked: (callback: (unlock: AchievementUnlock) => void) => () => void
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
      checkIntegration: () => Promise<{ adapters: AdapterRuntimeStatus[] }>
      diagnoseAdapter: (id: AgentAdapterId) => Promise<{
        ok: boolean
        report?: DiagnosticReport
        error?: string
      }>
      installAdapter: (id: AgentAdapterId) => Promise<{
        ok: boolean
        status?: AdapterDetection
        error?: string
      }>
      uninstallAdapter: (id: AgentAdapterId) => Promise<{
        ok: boolean
        status?: AdapterDetection
        error?: string
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
      getHistorySummary: (projectId?: string) => Promise<HistorySummary | null>
      listProjectPets: () => Promise<ProjectPetView[]>
      pickProjectPet: () => Promise<ProjectPetCommandResult>
      setProjectPetBinding: (projectId: string, petId: string | null) => Promise<ProjectPetCommandResult>
      archiveProjectPet: (projectId: string) => Promise<ProjectPetArchiveResult>
      getProjectPetsEnabled: () => Promise<boolean>
      setProjectPetsEnabled: (enabled: boolean) => Promise<boolean>
      clearHistory: () => Promise<HistoryClearResult>
      exportHistory: () => Promise<HistoryCommandResult>
      onHistoryUpdated: (callback: () => void) => () => void
      testIntegration: (source: 'opencode-cli' | 'opencode-desktop' | 'codex' | 'codex-desktop' | 'claude' | 'claude-desktop') => Promise<{
        ok: boolean
        verifiedAt?: number
        error?: string
      }>
      installIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
      setupProjectMcp: () => Promise<ProjectMcpSetupSummary>
      listProjectMcp: () => Promise<ProjectMcpRegistrySnapshot>
      removeProjectMcp: (projectPath: string) => Promise<ProjectMcpRemovalSummary>
      forgetProjectMcp: (projectPath: string) => Promise<{ ok: boolean; removed: boolean; error?: string }>
      uninstallIntegrations: (target?: 'opencode' | 'codex' | 'claude' | 'claudeCode') => Promise<{ ok: boolean; error?: string }>
      loadPets: () => Promise<Array<{
        id: string
        displayName: string
        folder: string
        builtIn: boolean
        behaviorManifest?: PetBehaviorManifest
      }>>
      addCustomPet: (petData: { id: string; displayName: string }) => Promise<boolean>
      renameCustomPet: (petId: string, newName: string) => Promise<boolean>
      removeCustomPet: (petId: string) => Promise<boolean>
      getCustomPetSprite: (petId: string) => Promise<string | null>
      importPetSprite: (petId: string, displayName: string) => Promise<string | null>
      importPetZip: () => Promise<{ ok: boolean; id?: string; displayName?: string; error?: string }>
    }
  }
}
