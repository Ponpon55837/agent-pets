import type { AgentSession, AgentSource } from '@/types/agent'
import { SOURCE_FAMILIES, STATE_PRIORITY } from '../types/agent.ts'

// States that wait on the user; among these the most recent one is shown first.
const ATTENTION_STATES: ReadonlySet<AgentSession['state']> = new Set(['waiting-permission', 'waiting-input', 'error'])

// "Who needs you" ordering: higher state priority first. Among waiting sessions the most recent
// wins (it rarely changes: waiting sessions send few events). Among working sessions lastSeenAt
// changes on every heartbeat, so the tie-break is the stable firstSeenAt (oldest first), then the
// key; otherwise two busy sessions would swap the line (and the multi-pet sprite) on each event.
export function compareAttention(a: AgentSession, b: AgentSession): number {
  const priorityDelta = (STATE_PRIORITY[b.state] ?? 0) - (STATE_PRIORITY[a.state] ?? 0)
  if (priorityDelta !== 0) return priorityDelta
  if (ATTENTION_STATES.has(a.state)) {
    const recencyDelta = b.lastSeenAt - a.lastSeenAt
    if (recencyDelta !== 0) return recencyDelta
  } else {
    const ageDelta = (a.firstSeenAt ?? a.lastSeenAt) - (b.firstSeenAt ?? b.lastSeenAt)
    if (ageDelta !== 0) return ageDelta
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export interface FamilyAttention<T extends AgentSession = AgentSession> {
  key: string
  label: string
  /** Most urgent active session of the family (compareAttention order). */
  top: T
  count: number
  sources: ReadonlySet<AgentSource>
}

const FAMILY_BY_SOURCE: ReadonlyMap<AgentSource, number> = new Map(
  SOURCE_FAMILIES.flatMap((family, index) => family.sources.map(source => [source, index] as const)),
)

/**
 * One pass over every session: per tool family, the most urgent active session, the active count
 * and which sources are active. O(n) with no sort, so it is cheap to recompute on every event.
 * Families come back in SOURCE_FAMILIES order; families with no active session are omitted.
 */
export function summarizeFamilies<T extends AgentSession>(sessions: Iterable<T>): FamilyAttention<T>[] {
  const slots: Array<{ top: T; count: number; sources: Set<AgentSource> } | undefined> = new Array(SOURCE_FAMILIES.length)
  for (const session of sessions) {
    if (session.state === 'offline') continue
    const index = FAMILY_BY_SOURCE.get(session.source)
    if (index === undefined) continue
    const slot = slots[index]
    if (!slot) {
      slots[index] = { top: session, count: 1, sources: new Set([session.source]) }
      continue
    }
    slot.count += 1
    slot.sources.add(session.source)
    if (compareAttention(session, slot.top) < 0) slot.top = session
  }
  const result: FamilyAttention<T>[] = []
  SOURCE_FAMILIES.forEach((family, index) => {
    const slot = slots[index]
    if (slot) result.push({ key: family.key, label: family.label, top: slot.top, count: slot.count, sources: slot.sources })
  })
  return result
}

/** The single most urgent active session, O(n). */
export function mostUrgentSession<T extends AgentSession>(sessions: Iterable<T>): T | null {
  let best: T | null = null
  for (const session of sessions) {
    if (session.state === 'offline') continue
    if (!best || compareAttention(session, best) < 0) best = session
  }
  return best
}

const MAX_PROJECT_CHARS = 24

/** Shortens a project display name for the pet's status line (the full name stays in the panel). */
export function truncateProject(name: string, max = MAX_PROJECT_CHARS): string {
  const characters = Array.from(name)
  return characters.length <= max ? name : `${characters.slice(0, max - 1).join('')}…`
}
