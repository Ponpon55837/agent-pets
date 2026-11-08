import { t, type TranslationKey } from '@/i18n'
import type { AgentState } from '@/types/agent'

// 狀態的口語化（已翻譯）名稱，給螢幕閱讀器用；畫面上的 STATE_LABELS 依慣例維持英文。
const STATE_ARIA_KEYS: Record<AgentState, TranslationKey> = {
  offline: 'pet.stateOffline',
  idle: 'pet.stateIdle',
  thinking: 'pet.stateThinking',
  'tool-running': 'pet.stateWorking',
  'waiting-permission': 'pet.statePermission',
  'waiting-input': 'pet.stateWaitingInput',
  success: 'pet.stateSuccess',
  error: 'pet.stateError',
}

export function stateAriaLabel(state: string): string {
  return t(STATE_ARIA_KEYS[state as AgentState] ?? 'pet.stateIdle')
}

// 寵物狀態列上的狀態詞一律用英文短字（使用者偏好，任何語系都一樣）；
// 已翻譯的完整說法仍留在 aria-label 與 tooltip（stateAriaLabel）。
// 刻意不放進語系檔：這組字不翻譯，也不等同面板用的 STATE_LABELS_SHORT。
export const STATE_LINE_WORDS: Readonly<Record<AgentState, string>> = {
  offline: 'Offline',
  idle: 'Idle',
  thinking: 'Thinking',
  'tool-running': 'Working',
  'waiting-permission': 'Permission',
  'waiting-input': 'Needs input',
  success: 'Done',
  error: 'Failed',
}

export function stateLineLabel(state: string): string {
  return STATE_LINE_WORDS[state as AgentState] ?? STATE_LINE_WORDS.idle
}
