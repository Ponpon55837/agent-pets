import type { AgentState } from '@/types/agent'

export type HistoryTokenQuality = 'none' | 'estimated' | 'exact'

export interface HistoryTokenUsageRecord {
  adapterId: string
  agentId: string
  sessionId?: string
  sourceEventId: string
  occurredAt: number
  input?: number
  output?: number
  quality: Exclude<HistoryTokenQuality, 'none'>
  /** Canonical project fingerprint from ProjectRoutingStore; never a raw path. */
  projectId?: string
}

export interface HistoryDailyStat {
  localDate: string
  sessionsCompleted: number
  sessionsFailed: number
  activeMs: number
  tokenInput: number
  tokenOutput: number
  tokenQuality: HistoryTokenQuality
}

export interface HistoryAgentStat {
  adapterId: string
  sessionsCompleted: number
  sessionsFailed: number
  activeMs: number
  tokenInput: number
  tokenOutput: number
  tokenQuality: HistoryTokenQuality
}

export interface HistoryQuotaWindow {
  id: string
  label: string
  remainingPercent: number
  resetsAt?: string
}

export interface HistoryQuotaProvider {
  id: string
  name: string
  plan?: string
  windows: HistoryQuotaWindow[]
}

export interface HistoryQuotaSnapshot {
  updatedAt: string
  providers: HistoryQuotaProvider[]
}

export interface HistorySummary {
  schemaVersion: 1
  generatedAt: number
  petId: string
  projectId?: string
  retentionDays: number
  days: HistoryDailyStat[]
  totals: HistoryDailyStat
  agents: HistoryAgentStat[]
  tokenQuality: HistoryTokenQuality
  // The effective start of local token counting: max(last "Clear History",
  // now - retentionDays). Counts before this point were never scanned, so
  // the UI needs it to tell the user what window the totals actually cover.
  tokenTrackingSince: number
  quota: HistoryQuotaSnapshot | null
}

export interface HistoryExport {
  schemaVersion: 1
  exportedAt: number
  summary: HistorySummary
}

export type HistoryCommandResult =
  | { ok: true; path?: string }
  | { ok: false; error: 'unavailable' | 'cancelled' | 'write_failed' }

export type HistoryClearResult =
  | { ok: true }
  | { ok: false; error: 'unavailable' }

export const HISTORY_TERMINAL_STATES = new Set<AgentState>(['success', 'error', 'offline'])
