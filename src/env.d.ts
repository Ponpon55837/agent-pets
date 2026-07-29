/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI?: {
    onAgentStatusEvent: (callback: (event: any) => void) => () => void
    moveWindow: (dx: number, dy: number) => void
    resizeWindow: (width: number, height: number) => void
    togglePanel: () => void
    resizePanel: (height: number) => void
    hidePanel: () => void
    onPanelOpened: (callback: () => void) => () => void
    quitApp: () => void
    checkIntegration: () => Promise<{
      opencode: { cli: boolean; desktop: boolean }
      codex: { hooks: boolean; enabled: boolean; configured: boolean; hookScript: boolean }
      claude: { config: boolean; hookScript: boolean }
      claudeCode: { settings: boolean; configured: boolean; hookScript: boolean }
    }>
    loadPets: () => Promise<Array<{ id: string; displayName: string; folder: string; builtIn: boolean }>>
    addCustomPet: (petData: { id: string; displayName: string }) => Promise<boolean>
    renameCustomPet: (petId: string, newName: string) => Promise<boolean>
    removeCustomPet: (petId: string) => Promise<boolean>
    getCustomPetSprite: (petId: string) => Promise<string | null>
    importPetSprite: (petId: string, displayName: string) => Promise<string | null>
  }
}
