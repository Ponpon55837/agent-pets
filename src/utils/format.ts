import { t } from '@/i18n'

export function formatProject(project?: string): string {
  if (!project) return ''
  const parts = project.split(/[/\\]/)
  return parts[parts.length - 1] || project
}

// The backend reports raw window ids/labels (e.g. "five_hour", "seven_day")
// that vary by provider; this maps them to the two labels the UI actually
// distinguishes between, falling back to the raw label for anything else.
export function quotaWindowLabel(id: string, label: string): string {
  const identity = `${id} ${label}`.toLowerCase()
  if (identity.includes('session') || identity.includes('five_hour')) return t('fiveHourLimit')
  if (identity.includes('weekly') || identity.includes('seven_day')) return t('weeklyLimit')
  return label
}

// Quota readouts round to a whole number once they're comfortably above
// zero, but keep one decimal place below 10% — the range where "0%" vs
// "0.4%" is the difference between reading as empty or nearly-empty.
export function roundQuotaPercent(value: number): number {
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
}
