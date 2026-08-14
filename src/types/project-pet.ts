export type ProjectPetBindingStatus = 'unbound' | 'bound' | 'missing-pet'

export interface ProjectPetView {
  projectId: string
  displayName: string
  boundPetId?: string
  bindingStatus: ProjectPetBindingStatus
  lastSeenAt: number
}

export type ProjectPetCommandResult =
  | { ok: true; project: ProjectPetView }
  | { ok: false; error: 'unavailable' | 'cancelled' | 'invalid_project' | 'invalid_pet' | 'not_found' }

export type ProjectPetArchiveResult =
  | { ok: true }
  | { ok: false; error: 'unavailable' | 'invalid_project' | 'not_found' }
