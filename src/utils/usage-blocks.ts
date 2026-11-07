import type { HistoryUsageBlock } from '@/types/history'

export const USAGE_BLOCK_MS = 5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export interface UsageBlockEntry {
  adapterId: string
  occurredAt: number
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  tokenCacheWrite: number
}

/** UTC 整點對齊；與 ccusage 相同，對整點時區（台北等）也等於本地整點。 */
export function floorToHour(timestamp: number): number {
  return Math.floor(timestamp / HOUR_MS) * HOUR_MS
}

/**
 * 依 ccusage `blocks` 的規則切出每個 agent 的最後一個 5 小時區塊：
 * - 依時間排序；第一筆用量開啟一個區塊，起點為該筆時間「向下取整到整點」。
 * - 下一筆若距區塊起點已滿 5 小時，或距上一筆用量已滿 5 小時，就結束目前區塊，
 *   並以該筆（同樣取整點）開新區塊。
 * 只回傳每個 agent 最後一個區塊；是否「進行中」交給 usageBlockView 依當下時間判斷。
 * O(n log n) 排序一次 + O(n) 單趟掃描；呼叫端若已依時間排序，排序近乎線性。
 */
export function latestUsageBlocks(entries: readonly UsageBlockEntry[]): HistoryUsageBlock[] {
  const sorted = entries
    .filter(entry => Number.isFinite(entry.occurredAt))
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt)
  const latest = new Map<string, HistoryUsageBlock>()
  for (const entry of sorted) {
    const current = latest.get(entry.adapterId)
    if (
      !current
      || entry.occurredAt - current.startAt >= USAGE_BLOCK_MS
      || entry.occurredAt - current.lastActivityAt >= USAGE_BLOCK_MS
    ) {
      const startAt = floorToHour(entry.occurredAt)
      latest.set(entry.adapterId, {
        adapterId: entry.adapterId,
        startAt,
        endAt: startAt + USAGE_BLOCK_MS,
        firstActivityAt: entry.occurredAt,
        lastActivityAt: entry.occurredAt,
        tokenInput: entry.tokenInput,
        tokenOutput: entry.tokenOutput,
        tokenCacheRead: entry.tokenCacheRead,
        tokenCacheWrite: entry.tokenCacheWrite,
        records: 1,
      })
      continue
    }
    current.lastActivityAt = entry.occurredAt
    current.tokenInput += entry.tokenInput
    current.tokenOutput += entry.tokenOutput
    current.tokenCacheRead += entry.tokenCacheRead
    current.tokenCacheWrite += entry.tokenCacheWrite
    current.records += 1
  }
  return [...latest.values()].sort((a, b) => a.adapterId.localeCompare(b.adapterId))
}

export interface UsageBlockView {
  active: boolean
  /** Fresh input + output, the same basis as the History headline. */
  tokens: number
  elapsedMs: number
  remainingMs: number
  /** Tokens per minute since the block's first activity (0 when under a minute of data). */
  burnRatePerMinute: number
}

/** 區塊在 `now` 時的狀態。進行中＝尚未到區塊終點，且距最後一筆用量未滿 5 小時。 */
export function usageBlockView(block: HistoryUsageBlock, now: number): UsageBlockView {
  const tokens = block.tokenInput + block.tokenOutput
  const active = now < block.endAt && now - block.lastActivityAt < USAGE_BLOCK_MS
  const clampedNow = Math.min(Math.max(now, block.startAt), block.endAt)
  const minutes = (Math.max(clampedNow, block.lastActivityAt) - block.firstActivityAt) / MINUTE_MS
  return {
    active,
    tokens,
    elapsedMs: clampedNow - block.startAt,
    remainingMs: active ? block.endAt - now : 0,
    burnRatePerMinute: minutes >= 1 ? Math.round(tokens / minutes) : 0,
  }
}
