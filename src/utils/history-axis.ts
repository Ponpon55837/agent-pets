// Trend-chart x-axis labels. A one-line "11/2（週一）" is wider than a day
// column at the panel's default width, so neighbouring labels ran into each
// other. The label is split into a date line and an optional weekday line;
// the full date stays in each bar's aria-label and the detail line.
import { formatDateParts } from './intl-format.ts'

export interface AxisLabelParts {
  date: string
  weekday: string
}

export function axisLabelParts(localDate: string, withWeekday: boolean, loc?: string): AxisLabelParts {
  const date = new Date(`${localDate}T12:00:00`)
  if (!Number.isFinite(date.getTime())) return { date: localDate, weekday: '' }
  return {
    date: formatDateParts(date, { month: 'numeric', day: 'numeric' }, loc),
    weekday: withWeekday ? formatDateParts(date, { weekday: 'short' }, loc) : '',
  }
}

/** Every `step`-th label counted back from the newest day, so today is always labelled. */
export function axisLabelVisible(index: number, length: number, step: number): boolean {
  return (length - 1 - index) % Math.max(1, step) === 0
}
