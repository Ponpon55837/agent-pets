import test from 'node:test'
import assert from 'node:assert/strict'
import { setLocale, t, translateBackendError } from '../src/i18n.ts'

test('Traditional Chinese translations cover core settings and interpolation', () => {
  setLocale('zh-TW')
  assert.equal(t('settings'), '設定')
  assert.equal(t('appearance'), '外觀')
  assert.equal(t('remainingPercent', { value: 87.5 }), '87.5% 剩餘')
  assert.equal(t('dayStreak', { days: 3 }), '3 天連續紀錄')
})

test('technical status and tool terms remain canonical where requested', () => {
  setLocale('zh-TW')
  assert.equal(t('miniMode'), 'Mini 模式')
  assert.equal(t('permissionBubbleHelp'), '顯示 Allow once / Deny 請求；隱藏後請求仍會保留待處理。')
  assert.equal(t('adapterNote').includes('Generic HTTP'), true)
})

test('backend error mapper localizes known and structured setup errors', () => {
  setLocale('zh-TW')
  assert.equal(translateBackendError('Unsupported adapter'), '不支援的 Adapter')
  assert.equal(translateBackendError('Configuration is not valid JSON: C:\\project\\.mcp.json'), '設定不是有效的 JSON：C:\\project\\.mcp.json')
  assert.equal(translateBackendError('Claude quota is rate limited. Wait a minute and retry.'), 'Claude Quota 受到速率限制，請稍候一分鐘再試。')
  assert.equal(translateBackendError('Codex usage request failed (429).'), 'Codex 用量請求失敗（429）。')
  assert.equal(translateBackendError('a custom diagnostic'), 'a custom diagnostic')
})

test('language selection switches shared renderer copy and keeps English diagnostics readable', () => {
  setLocale('en-US')
  assert.equal(t('settings'), 'Settings')
  assert.equal(t('languageHelp'), 'Choose the language used by the panel, Tray, notifications, and setup messages.')
  assert.equal(translateBackendError('Unsupported adapter'), 'Unsupported adapter')
  setLocale('zh-TW')
})
