import { ref } from 'vue'

// Theme = which palette the panel layer (--organic-* / --color-*) uses.
// The desktop-pet layer (bubbles) is deliberately always dark.
//   preference: 'system' follows the OS, 'light' / 'dark' force it.
// Applied as <html data-theme="light|dark">; tokens.css supplies the values.
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'agent-pet-theme'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export const themePreference = ref<ThemePreference>('system')
export const resolvedTheme = ref<ResolvedTheme>('light')

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function readStored(): ThemePreference {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null
    return isThemePreference(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function apply(): void {
  resolvedTheme.value = resolveTheme(themePreference.value, systemPrefersDark())
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = resolvedTheme.value
}

export function setThemePreference(value: unknown): ThemePreference {
  themePreference.value = isThemePreference(value) ? value : 'system'
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, themePreference.value)
  } catch {}
  apply()
  return themePreference.value
}

let initialized = false

/** Call once before mounting. Idempotent. */
export function initTheme(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  themePreference.value = readStored()
  apply()
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  }
  // The pet and panel windows share one origin, so a storage event keeps
  // both in step without IPC.
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY) {
      themePreference.value = readStored()
      apply()
    }
  })
  // Inactive-window hook for CSS (liquid-glass.md: de-emphasise when blurred).
  const mark = () => {
    document.documentElement.toggleAttribute('data-window-blurred', !document.hasFocus())
  }
  window.addEventListener('focus', mark)
  window.addEventListener('blur', mark)
  mark()
}
