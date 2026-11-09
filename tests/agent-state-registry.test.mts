import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STATE_COLORS,
  STATE_LABELS,
  STATE_LABELS_SHORT,
  STATE_PRIORITY,
} from '../src/types/agent.ts'
import { STATE_LINE_WORDS } from '../src/utils/state-line-words.ts'
import { shouldPlayCue, type SoundGate } from '../src/utils/sound-policy.ts'
import { classifyNotification } from '../electron/notification-policy.ts'
import { nextFinalState } from '../electron/history-sessions.ts'

// 特性測試：鎖住重構成 registry 前的每一個「狀態 → 值」輸出，任何一格變了都算外部契約改變。

const STATES = [
  'offline', 'idle', 'thinking', 'tool-running',
  'waiting-permission', 'waiting-input', 'success', 'error',
] as const

test('priority, labels, colors and status-line words stay exactly as before', () => {
  assert.deepEqual(STATE_PRIORITY, {
    'waiting-permission': 100, error: 90, 'waiting-input': 85, 'tool-running': 80,
    thinking: 70, success: 60, idle: 20, offline: 0,
  })
  assert.deepEqual(STATE_LABELS, {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Running Tool',
    'waiting-permission': 'Waiting Permission', 'waiting-input': 'Waiting Input', success: 'Success', error: 'Error',
  })
  assert.deepEqual(STATE_LABELS_SHORT, {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Running',
    'waiting-permission': 'Permission', 'waiting-input': 'Waiting', success: 'Success', error: 'Error',
  })
  assert.deepEqual(STATE_COLORS, {
    offline: 'var(--state-offline)', idle: 'var(--state-idle)',
    thinking: 'var(--state-active)', 'tool-running': 'var(--state-active)',
    'waiting-permission': 'var(--state-warn)', 'waiting-input': 'var(--state-warn)',
    success: 'var(--state-success)', error: 'var(--state-error)',
  })
  assert.deepEqual(STATE_LINE_WORDS, {
    offline: 'Offline', idle: 'Idle', thinking: 'Thinking', 'tool-running': 'Working',
    'waiting-permission': 'Permission', 'waiting-input': 'Needs input', success: 'Done', error: 'Failed',
  })
})

test('desktop notifications per state are unchanged', () => {
  const base = { source: 'codex', sessionId: 's1', project: 'p', timestamp: 1 }
  const session = { source: 'codex', sessionId: 's1' }
  const expected: Record<string, unknown> = {
    offline: null,
    idle: null,
    thinking: null,
    'tool-running': null,
    'waiting-permission': { key: 'codex:s1:waiting-permission', kind: 'waiting-permission', title: 'Codex 需要你的權限確認', body: 'p', terminal: false, session },
    'waiting-input': { key: 'codex:s1:waiting-input', kind: 'waiting-input', title: 'Codex 正在等待輸入', body: 'p', terminal: false, session },
    success: { key: 'codex:s1:success', kind: 'success', title: 'Codex 工作已完成', body: 'p', terminal: true },
    error: { key: 'codex:s1:error', kind: 'error', title: 'Codex 工作失敗', body: 'p', terminal: true },
    // 事件字串不在 AgentState 內（含原型鏈上的名稱）一律不通知。
    bogus: null,
    constructor: null,
    toString: null,
  }
  for (const [state, value] of Object.entries(expected)) {
    assert.deepEqual(classifyNotification({ ...base, state } as any), value, state)
  }
  assert.deepEqual(classifyNotification({
    source: 'claude', sessionId: 's1', state: 'waiting-permission', timestamp: 1,
    permissionNotice: { responseMode: 'external_only' },
  } as any), {
    key: 'claude:s1:waiting-permission', kind: 'waiting-permission',
    title: 'Claude 等你核准（請回原工具處理）', body: 'Agent 工作', terminal: false,
    session: { source: 'claude', sessionId: 's1' },
  })
})

test('history final-state classification per state is unchanged', () => {
  const previous = [null, 'success', 'error', 'cancelled', 'open'] as const
  const expected: Record<string, string[]> = {
    offline: ['cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled'],
    idle: ['open', 'success', 'error', 'cancelled', 'open'],
    thinking: ['open', 'open', 'open', 'open', 'open'],
    'tool-running': ['open', 'open', 'open', 'open', 'open'],
    'waiting-permission': ['open', 'open', 'open', 'open', 'open'],
    'waiting-input': ['open', 'open', 'open', 'open', 'open'],
    success: ['success', 'success', 'success', 'success', 'success'],
    error: ['error', 'error', 'error', 'error', 'error'],
    // 不認得的狀態沿用上一輪結果，跟 idle 相同。
    bogus: ['open', 'success', 'error', 'cancelled', 'open'],
    constructor: ['open', 'success', 'error', 'cancelled', 'open'],
  }
  for (const [state, values] of Object.entries(expected)) {
    assert.deepEqual(previous.map(p => nextFinalState(p, state as any)), values, state)
  }
})

test('sound cues keep their per-cue switches and master gates', () => {
  const open: SoundGate = {
    soundEnabled: true, dndEnabled: false, petVisible: true,
    soundOnPermission: true, soundOnError: true, soundOnSuccess: true,
  }
  const closed: SoundGate = { ...open, soundOnPermission: false, soundOnError: false, soundOnSuccess: false }
  for (const cue of ['success', 'error', 'waiting-permission', 'waiting-input'] as const) {
    assert.equal(shouldPlayCue(cue, open), true, cue)
    // waiting-input 沒有自己的開關，只跟總開關。
    assert.equal(shouldPlayCue(cue, closed), cue === 'waiting-input', cue)
    assert.equal(shouldPlayCue(cue, { ...open, soundEnabled: false }), false, cue)
    assert.equal(shouldPlayCue(cue, { ...open, dndEnabled: true }), false, cue)
    assert.equal(shouldPlayCue(cue, { ...open, petVisible: false }), false, cue)
  }
  for (const [flag, cue] of [['soundOnPermission', 'waiting-permission'], ['soundOnError', 'error'], ['soundOnSuccess', 'success']] as const) {
    assert.equal(shouldPlayCue(cue, { ...open, [flag]: false }), false, cue)
  }
})

test('the characterization covers every AgentState', () => {
  assert.deepEqual(Object.keys(STATE_PRIORITY).sort(), [...STATES].sort())
})
