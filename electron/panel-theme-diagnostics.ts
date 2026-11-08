// 主題編輯器的驗證診斷（spec R21）。純函式：不 import Electron 或 Node。
//
// 與插件主題用同一個驗證器：先嚴格解析使用者定義，再把每個模式交給 panelThemeModeIssues
// （parsePanelThemes 只取它的第一個值）。這裡走完所有問題，並為每個出錯的鍵找一個「建議值」：
// 保留色相與色度、只在 OKLCH 明度上由近而遠搜尋，接受的條件是「這個鍵的問題全部消失，而且
// 沒有產生任何新問題」。狀態色的色相／色度問題先把色相移進允許區間。搜尋有總次數上限，
// 所以最壞情況的時間也是有界的；結果是確定性的（同樣的輸入一定得到同樣的建議）。

import { formatPanelThemeColor, oklchToRgb, rgbToOklch, type PanelThemeRgba } from './panel-theme-color.ts'
import {
  PANEL_THEME_STATE_HUES,
  minimumPanelThemeOverlay,
  panelThemeModeCheckInput,
  panelThemeModeIssues,
  PanelThemeValidationError,
  resolvePanelThemes,
  type PanelThemeIssue,
  type PanelThemeModeCheckInput,
} from './plugin-panel-themes.ts'
import { parseUserPanelThemeDefinition, userPanelThemeContribution } from './panel-theme-user.ts'
import { PANEL_THEME_MODES, type PanelThemeMode } from '../src/types/panel-theme.ts'
import type { PanelThemeDiagnostic, PanelThemeValidation } from '../src/types/panel-theme-user.ts'

/** 回傳的問題數上限（payload 有界）。 */
export const PANEL_THEME_DIAGNOSTIC_MAX_ISSUES = 64
/** 一次驗證最多評估的候選色數（所有鍵合計）。 */
export const PANEL_THEME_SUGGESTION_BUDGET = 1600
const LIGHTNESS_STEP = 0.01
const MAX_STEPS = 100
const STATE_MIN_SUGGESTED_CHROMA = 0.09

function issueId(issue: PanelThemeIssue): string {
  return `${issue.path}\u0000${issue.kind}\u0000${issue.foreground ?? ''}\u0000${issue.background ?? ''}`
}

/**
 * 狀態色的建議色相：各自允許區間（PANEL_THEME_STATE_HUES）裡最典型的位置（紅、綠、琥珀、藍），
 * 而不是離目前色相最近的邊界，避免把「危險」建議成接近橘色的邊界值。
 */
export const PANEL_THEME_STATE_PREFERRED_HUES: Readonly<Record<keyof typeof PANEL_THEME_STATE_HUES, number>> = Object.freeze({
  dangerText: 27,
  successText: 140,
  warnText: 75,
  infoText: 250,
})

function replaced(input: PanelThemeModeCheckInput, group: 'colors' | 'petStatus', key: string, color: PanelThemeRgba): PanelThemeModeCheckInput {
  if (group === 'colors') return { ...input, colors: { ...input.colors, [key]: color } }
  return { ...input, petStatus: { ...input.petStatus!, [key]: color } }
}

interface Budget { remaining: number }

function suggestColor(input: PanelThemeModeCheckInput, issue: PanelThemeIssue, current: readonly PanelThemeIssue[], budget: Budget): string | undefined {
  const match = /^(colors|petStatus)\.([A-Za-z0-9]+)$/.exec(issue.path)
  if (!match) return undefined
  const group = match[1] as 'colors' | 'petStatus'
  const key = match[2]!
  const color = group === 'colors' ? input.colors[key as keyof typeof input.colors] : input.petStatus?.[key as keyof NonNullable<typeof input.petStatus>]
  if (!color) return undefined
  const baseline = new Set(current.filter(other => other.path !== issue.path).map(issueId))
  const accepted = (candidate: PanelThemeRgba) => {
    for (const next of panelThemeModeIssues(replaced(input, group, key, candidate))) {
      if (next.path === issue.path || !baseline.has(issueId(next))) return false
    }
    return true
  }
  if (issue.kind === 'alpha') {
    const candidate = { ...color, a: issue.required ?? 1 }
    budget.remaining -= 1
    return accepted(candidate) ? formatPanelThemeColor(candidate) : undefined
  }
  const start = rgbToOklch(color)
  let hue = start.h
  let chroma = start.c
  if (group === 'colors' && current.some(other => other.path === issue.path && (other.kind === 'hue' || other.kind === 'chroma'))) {
    hue = PANEL_THEME_STATE_PREFERRED_HUES[key as keyof typeof PANEL_THEME_STATE_PREFERRED_HUES] ?? hue
    chroma = Math.max(chroma, STATE_MIN_SUGGESTED_CHROMA)
  }
  for (let step = 0; step <= MAX_STEPS; step += 1) {
    for (const direction of step === 0 ? [0] : [1, -1]) {
      const lightness = start.l + direction * step * LIGHTNESS_STEP
      if (lightness < 0 || lightness > 1) continue
      if (budget.remaining <= 0) return undefined
      budget.remaining -= 1
      const candidate = oklchToRgb(lightness, chroma, hue, color.a)
      if (candidate.r === color.r && candidate.g === color.g && candidate.b === color.b) continue
      if (accepted(candidate)) return formatPanelThemeColor(candidate)
    }
  }
  return undefined
}

function suggestion(input: PanelThemeModeCheckInput, issue: PanelThemeIssue, current: readonly PanelThemeIssue[], budget: Budget): string | number | undefined {
  // 覆蓋層：最小值就是建議值（沒有任何值能通過時不給建議）。
  if (issue.kind === 'overlay') return issue.required
  return suggestColor(input, issue, current, budget)
}

/**
 * 驗證一份「我的主題」定義（不安裝、不儲存）。結構或文法錯誤只回報第一個；語意問題全部列出
 * （每個模式依驗證器的順序，總數有上限），每個出錯的鍵附上建議值。
 */
export function validateUserPanelTheme(value: unknown): PanelThemeValidation {
  const parsed = parseUserPanelThemeDefinition(value)
  if (!parsed.ok) return { valid: false, schemaError: { path: parsed.path, problem: parsed.problem }, issues: [], minDim: {} }
  const contribution = userPanelThemeContribution('draft', 'Draft', parsed.value)
  const modes = contribution.modes as Record<PanelThemeMode, unknown>
  const issues: PanelThemeDiagnostic[] = []
  const minDim: Partial<Record<PanelThemeMode, number>> = {}
  const budget: Budget = { remaining: PANEL_THEME_SUGGESTION_BUDGET }
  for (const mode of PANEL_THEME_MODES) {
    let input: PanelThemeModeCheckInput
    try {
      input = panelThemeModeCheckInput(modes[mode], mode)
    } catch (error) {
      if (!(error instanceof PanelThemeValidationError)) throw error
      return { valid: false, schemaError: { path: mode, problem: error.diagnostic }, issues: [], minDim: {} }
    }
    if (input.userImageOverlay) {
      const minimum = minimumPanelThemeOverlay(input.colors, input.userImageOverlay.color, 1)
      if (minimum !== null) minDim[mode] = minimum
    }
    const modeIssues = [...panelThemeModeIssues(input)]
    const suggested = new Map<string, string | number | undefined>()
    for (const issue of modeIssues) {
      if (issues.length >= PANEL_THEME_DIAGNOSTIC_MAX_ISSUES) break
      if (!suggested.has(issue.path)) suggested.set(issue.path, suggestion(input, issue, modeIssues, budget))
      const value = suggested.get(issue.path)
      issues.push({ mode, ...issue, ...(value !== undefined ? { suggested: value } : {}) })
    }
  }
  // 最後以安裝／套用時的同一個入口再確認一次（字型組合、圓角與兩個模式一起）。
  const valid = issues.length === 0 && resolvePanelThemes([contribution]) !== null
  return { valid, issues, minDim }
}
