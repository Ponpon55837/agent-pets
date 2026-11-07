type Schedule = (callback: () => void) => void

const scheduleInNextTurn: Schedule = callback => { setImmediate(callback) }

/** Coalesces projections where only the most recent value is observable. */
export function createLatestValueCoalescer<T>(flush: (value: T) => void, schedule: Schedule = scheduleInNextTurn): (value: T) => void {
  let scheduled = false
  let hasValue = false
  let latest: T

  return value => {
    latest = value
    hasValue = true
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      if (!hasValue) return
      const valueToFlush = latest
      hasValue = false
      flush(valueToFlush)
    })
  }
}

/** Batches events while preserving every item and its insertion order. */
export interface OrderedBatchLimits<T> {
  /** Upper bound on queued items between flushes. */
  maxPending: number
  /** Items that must survive overflow (terminal events); others are dropped first, oldest first. */
  isPriority?: (value: T) => boolean
  onDrop?: (value: T) => void
}

export function createOrderedBatchCoalescer<T>(
  flush: (values: readonly T[]) => void,
  schedule: Schedule = scheduleInNextTurn,
  limits?: OrderedBatchLimits<T>,
): (value: T) => void {
  let scheduled = false
  let pending: T[] = []

  return value => {
    if (limits && pending.length >= limits.maxPending) {
      let victim = limits.isPriority ? pending.findIndex(item => !limits.isPriority!(item)) : 0
      if (victim < 0) {
        // The queue is all priority items: shed the incoming one only if it is
        // not priority itself, otherwise the oldest priority item.
        if (!limits.isPriority!(value)) { limits.onDrop?.(value); return }
        victim = 0
      }
      const [dropped] = pending.splice(victim, 1)
      limits.onDrop?.(dropped)
    }
    pending.push(value)
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      const values = pending
      pending = []
      if (values.length > 0) flush(values)
    })
  }
}
