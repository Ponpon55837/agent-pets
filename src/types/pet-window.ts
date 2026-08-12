export type PetWindowMode = 'normal' | 'mini' | 'edge'
export type PetEdge = 'left' | 'right' | 'top' | 'bottom'

export interface PetWindowModeState {
  mode: PetWindowMode
  edge?: PetEdge
}

export function normalizePetWindowModeState(value: unknown): PetWindowModeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { mode: 'normal' }
  }
  const raw = value as Record<string, unknown>
  if (raw.mode !== 'normal' && raw.mode !== 'mini' && raw.mode !== 'edge') {
    return { mode: 'normal' }
  }
  const edge = raw.edge === 'left' || raw.edge === 'right' || raw.edge === 'top' || raw.edge === 'bottom'
    ? raw.edge
    : undefined
  return edge && raw.mode === 'edge' ? { mode: raw.mode, edge } : { mode: raw.mode }
}
