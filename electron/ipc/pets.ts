import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { SanitizedPetBehaviorManifest } from '../pet-behavior-manifest'
import { handleWithSenderGuard } from './trusted.ts'
import { IPC_CHANNELS } from './channels.ts'

type PetSkinKind = 'person' | 'animal'
type PetSkinContribution = {
  id: string
  displayName: Record<string, string>
  spritesheet: string
  behaviorManifest?: unknown
  kind: PetSkinKind
}
type PluginPetContext = {
  enabled: boolean
  manifest: {
    name: Record<string, string>
    contributes: { skins?: PetSkinContribution[] }
  }
}
export type PetLoadItem = {
  id: string
  displayName: string
  folder: string
  builtIn: boolean
  behaviorManifest?: SanitizedPetBehaviorManifest
  pluginSkin?: {
    pluginId: string
    pluginName: string
    spriteUrl: string
    cacheKey: string
    kind: PetSkinKind
  }
}

type PetLoadFileSystem = Pick<typeof import('node:fs'), 'readFileSync' | 'existsSync' | 'readdirSync'>
type PetLoadPath = Pick<typeof import('node:path'), 'resolve'>

export interface PetsIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent): void
  fs: PetLoadFileSystem
  path: PetLoadPath
  builtinPetsPath(): string
  customPetsPath(): string
  parseBehaviorManifest(value: unknown): SanitizedPetBehaviorManifest | undefined
  sanitizePetId(value: string): string | null
  safeJoin(base: string, ...parts: string[]): string | null
  pluginsEnabled(): boolean
  pluginContexts(): Iterable<[string, PluginPetContext]>
  enabledPluginRoot(pluginId: string): string | null
  createPluginSkinPetId(pluginId: string, skinId: string): string | null
  readRegularFileWithin(root: string, relativePath: string, maxBytes: number): Uint8Array | null
  rasterContentType(data: Uint8Array): string | null
  pluginSkinImageMaxBytes: number
  locale(): string
  pluginVersion(pluginId: string): string
}

export function loadPets(deps: Omit<PetsIpcDependencies, 'ipcMain' | 'assertTrustedIpcSender'>): PetLoadItem[] {
  let builtin: PetLoadItem[] = []
  try {
    const raw = deps.fs.readFileSync(deps.builtinPetsPath(), 'utf-8')
    builtin = JSON.parse(raw).map((pet: Record<string, unknown>) => {
      const behaviorManifest = deps.parseBehaviorManifest(pet.behaviorManifest)
      return {
        id: String(pet.id || ''),
        displayName: String(pet.displayName || pet.id || ''),
        folder: String(pet.folder || pet.id || ''),
        builtIn: true,
        ...(behaviorManifest ? { behaviorManifest } : {}),
      }
    })
  } catch {}

  const customBase = deps.path.resolve(deps.customPetsPath(), 'custom')
  const custom: PetLoadItem[] = []
  if (deps.fs.existsSync(customBase)) {
    const entries = deps.fs.readdirSync(customBase, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const safe = deps.sanitizePetId(entry.name)
      if (!safe) continue
      const petJsonPath = deps.safeJoin(customBase, safe, 'pet.json')
      if (!petJsonPath || !deps.fs.existsSync(petJsonPath)) continue
      try {
        const petData = JSON.parse(deps.fs.readFileSync(petJsonPath, 'utf-8')) as Record<string, unknown>
        const behaviorManifest = deps.parseBehaviorManifest(petData.behaviorManifest)
        custom.push({
          id: String(petData.id || safe),
          displayName: String(petData.displayName || safe),
          folder: safe,
          builtIn: false,
          ...(behaviorManifest ? { behaviorManifest } : {}),
        })
      } catch {}
    }
  }

  const pluginSkins: PetLoadItem[] = []
  if (deps.pluginsEnabled()) {
    const locale = deps.locale()
    for (const [pluginId, context] of deps.pluginContexts()) {
      if (!context.enabled) continue
      const root = deps.enabledPluginRoot(pluginId)
      if (!root) continue
      for (const skin of context.manifest.contributes.skins ?? []) {
        const id = deps.createPluginSkinPetId(pluginId, skin.id)
        if (!id) continue
        const image = deps.readRegularFileWithin(root, skin.spritesheet, deps.pluginSkinImageMaxBytes)
        if (!image || !deps.rasterContentType(image)) continue
        const encodedPath = skin.spritesheet.split('/').map(segment => encodeURIComponent(segment)).join('/')
        const behaviorManifest = deps.parseBehaviorManifest(skin.behaviorManifest)
        pluginSkins.push({
          id,
          displayName: skin.displayName[locale],
          folder: '',
          builtIn: false,
          ...(behaviorManifest ? { behaviorManifest } : {}),
          pluginSkin: {
            pluginId,
            pluginName: context.manifest.name[locale],
            spriteUrl: `agent-pets://plugin/${pluginId}/${encodedPath}`,
            cacheKey: `${pluginId}:${deps.pluginVersion(pluginId)}:${skin.spritesheet}`,
            kind: skin.kind,
          },
        })
      }
    }
  }

  return [...builtin, ...custom, ...pluginSkins]
}

export function registerPetsIpc(deps: PetsIpcDependencies): void {
  handleWithSenderGuard(deps.ipcMain, IPC_CHANNELS.loadPets, deps.assertTrustedIpcSender, () => {
    return loadPets(deps)
  })
}
