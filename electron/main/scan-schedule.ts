export const LOCAL_USAGE_TICK_MS = 60_000
/** On battery the scan runs every Nth tick (about five minutes) to avoid waking the disk. */
export const LOCAL_USAGE_BATTERY_TICK_DIVISOR = 5

/** Returns whether the scan should run on this 1-based tick of the base interval. */
export function shouldRunLocalUsageTick(tick: number, onBattery: boolean): boolean {
  if (!onBattery) return true
  return tick % LOCAL_USAGE_BATTERY_TICK_DIVISOR === 0
}
