export const SUPPORTED_LOCALES = ['zh-TW', 'en-US'] as const

export type AppLocale = typeof SUPPORTED_LOCALES[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-TW'

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string'
    && (value === 'zh-TW' || value === 'en-US')
}
