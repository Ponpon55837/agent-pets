import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { guardArchive } from '../archive-guard.ts'
import type { SanitizedPetBehaviorManifest } from '../pet-behavior-manifest'
import { IPC_CHANNELS } from './channels.ts'

type OpenDialogResult = { canceled: boolean; filePaths: string[] }
type OpenDialogOptions = {
  title: string
  message?: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties: Array<'openFile'>
}
type FileSystemPort = Pick<typeof import('node:fs'), 'statSync' | 'lstatSync' | 'readFileSync' | 'writeFileSync' | 'existsSync' | 'rmSync'>
type PathPort = Pick<typeof import('node:path'), 'basename' | 'join'>

export interface PetAssetIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  assertTrustedIpcSender(event: IpcMainInvokeEvent, requiredWindow?: BrowserWindow | null): void
  getPanelWindow(): BrowserWindow | null
  getPetWindow(): BrowserWindow | null
  setDialogOpen(value: boolean): void
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogResult>
  customPetsRoot(): string
  safeJoin(base: string, ...parts: string[]): string | null
  sanitizePetId(value: string): string | null
  ensureDir(path: string): void
  writeFileEnsured(path: string, contents: string): void
  parsePetBehaviorManifest(value: unknown): SanitizedPetBehaviorManifest | undefined
  isSupportedRasterImage(data: Uint8Array): boolean
  guardArchive: typeof guardArchive
  fs: FileSystemPort
  path: PathPort
  customPetDescription(): string
  maxPetZipBytes: number
  maxPetZipEntries: number
  maxPetUncompressedBytes: number
  maxPetJsonBytes: number
  maxPetImageBytes: number
}

export function registerPetAssetIpc(deps: PetAssetIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.addCustomPet, (event, petData: unknown) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    if (!petData || typeof petData !== 'object') return false
    const data = petData as Record<string, unknown>
    const safeId = deps.sanitizePetId(typeof data.id === 'string' ? data.id : '')
    if (!safeId) return false
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return false

    deps.ensureDir(customDir)
    const petJson = {
      id: safeId,
      displayName: String(data.displayName || safeId).slice(0, 64),
      description: deps.customPetDescription(),
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    deps.writeFileEnsured(deps.path.join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return true
  })

  deps.ipcMain.handle(IPC_CHANNELS.renameCustomPet, (event, petId: string, newName: string) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const safeId = deps.sanitizePetId(petId)
    if (!safeId) return false
    if (typeof newName !== 'string' || newName.trim().length === 0) return false
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return false
    const petJsonPath = deps.safeJoin(customDir, 'pet.json')
    if (!petJsonPath || !deps.fs.existsSync(petJsonPath)) return false
    try {
      const petData = JSON.parse(deps.fs.readFileSync(petJsonPath, 'utf-8'))
      petData.displayName = newName.trim().slice(0, 64)
      deps.writeFileEnsured(petJsonPath, JSON.stringify(petData, null, 2))
      return true
    } catch {
      return false
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.removeCustomPet, (event, petId: string) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const safeId = deps.sanitizePetId(petId)
    if (!safeId) return false
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return false
    if (deps.fs.existsSync(customDir)) {
      deps.fs.rmSync(customDir, { recursive: true, force: true })
      return true
    }
    return false
  })

  deps.ipcMain.handle(IPC_CHANNELS.getCustomPetSprite, (event, petId: string) => {
    deps.assertTrustedIpcSender(event)
    const safeId = deps.sanitizePetId(petId)
    if (!safeId) return null
    const spritePath = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId, 'spritesheet.webp')
    if (!spritePath) return null
    if (deps.fs.existsSync(spritePath)) {
      return `agent-pets://custom/${encodeURIComponent(safeId)}/spritesheet.webp`
    }
    return null
  })

  // Accepts sprite kits from community sites like codex-pets.net: a .zip
  // containing pet.json + a spritesheet image, laid out on the same
  // 192x208-per-frame grid our own built-in pets use (see PetAnimation.vue).
  deps.ipcMain.handle(IPC_CHANNELS.importPetZip, async (event) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!owner) return { ok: false, error: 'No window available' }

    deps.setDialogOpen(true)
    const result = await deps.showOpenDialog(owner, {
      title: '選擇寵物素材包（.codex-pet.zip）',
      filters: [{ name: 'Pet sprite kit', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    deps.setDialogOpen(false)
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'cancelled' }

    try {
      const zipPath = result.filePaths[0]
      const zipStat = deps.fs.statSync(zipPath)
      if (!zipStat.isFile() || zipStat.size > deps.maxPetZipBytes) {
        return { ok: false, error: 'Zip must be a regular file no larger than 10 MB' }
      }
      const zipBuf = deps.fs.readFileSync(zipPath)
      if (zipBuf.length > deps.maxPetZipBytes) {
        return { ok: false, error: 'Zip must be no larger than 10 MB' }
      }

      const guarded = deps.guardArchive(new Uint8Array(zipBuf), {
        maxTotalBytes: deps.maxPetUncompressedBytes,
        maxFileBytes: deps.maxPetUncompressedBytes,
        maxFiles: deps.maxPetZipEntries,
        allowedExtensions: ['.json', '.webp', '.png', '.jpg', '.jpeg'],
        mode: 'compat',
        includePath: relativePath => !relativePath.split('/').includes('__MACOSX')
          && !deps.path.basename(relativePath).startsWith('._')
          && (/(^|\/)pet\.json$/i.test(relativePath) || /\.(webp|png|jpe?g)$/i.test(relativePath)),
      })
      if (!guarded.ok) {
        const error = guarded.error === 'file_limit_exceeded'
          ? 'Zip contains too many entries'
          : guarded.error === 'total_size_exceeded' || guarded.error === 'file_size_exceeded'
            ? 'Zip expands beyond the 25 MB safety limit'
            : guarded.error === 'unsafe_path' || guarded.error === 'duplicate_path'
              ? 'Zip contains an unsafe or duplicate path'
              : 'Invalid zip archive'
        return { ok: false, error }
      }
      const entries = guarded.files
      const entryNames = [...entries.keys()]

      const petJsonName = entryNames.find((name) => /(^|\/)pet\.json$/i.test(name))
      if (!petJsonName) return { ok: false, error: 'No pet.json found in this zip' }
      const petJsonBytes = entries.get(petJsonName)
      if (!petJsonBytes || petJsonBytes.byteLength > deps.maxPetJsonBytes) {
        return { ok: false, error: 'pet.json exceeds the 256 KB safety limit' }
      }

      const petData = JSON.parse(Buffer.from(petJsonBytes).toString('utf-8'))
      const rawId = String(petData.id || petData.displayName || `imported-${Date.now()}`)
      const safeId = deps.sanitizePetId(rawId) || deps.sanitizePetId(`pet-${Date.now()}`)
      if (!safeId) return { ok: false, error: 'Could not derive a valid pet id' }

      const imageExt = /\.(webp|png|jpe?g)$/i
      const wantedBase = petData.spritesheetPath
        ? deps.path.basename(String(petData.spritesheetPath)).toLowerCase()
        : null
      const spriteName =
        entryNames.find((name) => deps.path.basename(name).toLowerCase() === wantedBase) ??
        entryNames.find((name) => imageExt.test(name))
      if (!spriteName) return { ok: false, error: 'No spritesheet image found in this zip' }
      const spriteData = entries.get(spriteName)
      if (!spriteData) return { ok: false, error: 'No spritesheet image found in this zip' }
      if (spriteData.byteLength > deps.maxPetImageBytes) {
        return { ok: false, error: 'Spritesheet exceeds the 20 MB safety limit' }
      }
      if (!deps.isSupportedRasterImage(spriteData)) {
        return { ok: false, error: 'Spritesheet content is not a valid PNG, JPEG, or WebP image' }
      }

      const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
      if (!customDir) return { ok: false, error: 'Invalid destination path' }
      deps.ensureDir(customDir)
      const behaviorManifest = deps.parsePetBehaviorManifest(petData.behaviorManifest)

      // Renderer sniffs the actual image bytes rather than trusting the
      // extension (see importPetSprite below), so normalizing to
      // spritesheet.webp here is safe even for a source .png/.jpg.
      deps.fs.writeFileSync(deps.path.join(customDir, 'spritesheet.webp'), Buffer.from(spriteData))

      const petJson = {
        id: safeId,
        displayName: String(petData.displayName || rawId).slice(0, 64),
        description: String(petData.description || 'Imported pet').slice(0, 500),
        spritesheetPath: 'spritesheet.webp',
        spriteVersionNumber: 2,
        kind: petData.kind === 'animal' ? 'animal' : 'person',
        ...(behaviorManifest ? { behaviorManifest } : {}),
      }
      deps.writeFileEnsured(deps.path.join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))

      return { ok: true, id: safeId, displayName: petJson.displayName }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  deps.ipcMain.handle(IPC_CHANNELS.importPetSprite, async (event, petId: string, displayName: string) => {
    deps.assertTrustedIpcSender(event, deps.getPanelWindow())
    const safeId = deps.sanitizePetId(petId)
    const owner = deps.getPanelWindow() ?? deps.getPetWindow()
    if (!safeId || !owner) return null
    deps.setDialogOpen(true)
    const result = await deps.showOpenDialog(owner, {
      title: '選擇 spritesheet（每格 192x208，.webp）',
      filters: [{ name: 'Images', extensions: ['webp', 'png', 'jpg'] }],
      properties: ['openFile'],
    })
    deps.setDialogOpen(false)
    if (result.canceled || result.filePaths.length === 0) return null
    const src = result.filePaths[0]
    const sourceStat = deps.fs.statSync(src)
    if (!sourceStat.isFile() || sourceStat.size > deps.maxPetImageBytes) return null
    const sourceData = deps.fs.readFileSync(src)
    if (sourceData.length > deps.maxPetImageBytes || !deps.isSupportedRasterImage(sourceData)) return null
    const customDir = deps.safeJoin(deps.customPetsRoot(), 'custom', safeId)
    if (!customDir) return null
    deps.ensureDir(customDir)
    const dest = deps.path.join(customDir, 'spritesheet.webp')
    deps.fs.writeFileSync(dest, sourceData)
    const petJson = {
      id: safeId,
      displayName: String(displayName || safeId).slice(0, 64),
      description: deps.customPetDescription(),
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
      kind: 'person',
    }
    deps.writeFileEnsured(deps.path.join(customDir, 'pet.json'), JSON.stringify(petJson, null, 2))
    return `agent-pets://custom/${encodeURIComponent(safeId)}/spritesheet.webp`
  })

}
