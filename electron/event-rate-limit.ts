export interface EventRateLimiterOptions {
  now?: () => number
  windowMs?: number
  /** Pre-parse ceiling across all callers; only protects the process from a request flood. */
  globalLimit?: number
  /** Ordinary events (heartbeats, tool use) per source session per window. */
  perSessionLimit?: number
  /** Terminal events (success/error/permission) get their own, separate budget per session. */
  terminalPerSessionLimit?: number
  maxTrackedSessions?: number
}

export interface EventRateLimiter {
  allowRequest(): boolean
  allowEvent(sessionKey: string, terminal: boolean): boolean
}

export function createEventRateLimiter(options: EventRateLimiterOptions = {}): EventRateLimiter {
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? 10_000
  const globalLimit = options.globalLimit ?? 2_000
  const perSession = options.perSessionLimit ?? 500
  const terminalPerSession = options.terminalPerSessionLimit ?? 60
  const maxTracked = options.maxTrackedSessions ?? 500

  let windowStartedAt = now()
  let requests = 0
  let counters = new Map<string, { normal: number; terminal: number }>()

  const roll = () => {
    const current = now()
    if (current - windowStartedAt >= windowMs) {
      windowStartedAt = current
      requests = 0
      counters = new Map()
    }
  }

  return {
    allowRequest() {
      roll()
      requests += 1
      return requests <= globalLimit
    },
    allowEvent(sessionKey, terminal) {
      roll()
      let entry = counters.get(sessionKey)
      if (!entry) {
        // Never let an attacker-chosen session id grow the table without bound.
        if (counters.size >= maxTracked) return true
        entry = { normal: 0, terminal: 0 }
        counters.set(sessionKey, entry)
      }
      if (terminal) {
        entry.terminal += 1
        return entry.terminal <= terminalPerSession
      }
      entry.normal += 1
      return entry.normal <= perSession
    },
  }
}
