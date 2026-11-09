#!/usr/bin/env node
// 真實 hook e2e：搭配 scripts/e2e-isolated-electron.mjs 使用，不碰使用者的 ~/.claude、正式版的埠或鑰匙圈。
// 在隔離 HOME 執行真正的安裝程式（產生隔離的 Claude Code settings 與 agent-hook.mjs），照 Claude Code 的方式
// 從那份 settings 讀出 hook 指令、以 stdin 送 payload，再經 CDP 讀寵物畫面。可選的寵物包會先經主程序 loadPets 清理。
// 用法（先 pnpm exec vite build，並用預設隔離埠啟動 node scripts/e2e-isolated-electron.mjs）：
//   node --experimental-strip-types scripts/e2e-real-hook.mts --home <啟動日誌的 home> [--debug-port 9348]
//        [--hook-port-base 27373] [--pet-pack]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const home = arg('--home')
const cdpPort = arg('--debug-port', '9348')
const portBase = Number(arg('--hook-port-base', '27373'))
const withPetPack = process.argv.includes('--pet-pack')
assert.ok(Number.isInteger(portBase) && portBase >= 1024 && portBase <= 65533 && portBase !== 17373, 'use the isolated ports, never 17373')
const realHome = os.homedir()
assert.ok(home && fs.existsSync(path.join(home, '.desktop-pet', 'event-token')) && !home.startsWith(realHome + path.sep) && home !== realHome, 'isolated HOME required')

const { configureSetupEnvironment } = await import(path.join(repoRoot, 'electron/setup-environment.ts'))
const setup = await import(path.join(repoRoot, 'electron/setup.ts'))
configureSetupEnvironment({
  homeDir: () => home,
  appData: () => path.join(home, 'AppData'),
  userData: () => path.join(home, 'userData'),
  isPackaged: () => false,
  integrationsDir: () => path.join(repoRoot, 'integrations'),
  nodePath: () => process.execPath,
})
const settingsPath: string = setup.claudeCodeSettingsPath()
const hookPath: string = setup.hookScriptPath()
for (const target of [settingsPath, hookPath]) {
  assert.ok(target.startsWith(home + path.sep), `refusing to write outside the isolated HOME: ${target}`)
}
setup.installIntegration('claudeCode')

// 已安裝的腳本寫死 17373/17374；隔離 app 聽在 portBase，只改這兩個網址。
const deployed = fs.readFileSync(hookPath, 'utf8')
const patched = deployed
  .replace('http://127.0.0.1:17373/v1/events', `http://127.0.0.1:${portBase}/v1/events`)
  .replace('http://127.0.0.1:17374/v1/permission', `http://127.0.0.1:${portBase + 1}/v1/permission`)
assert.equal(deployed.split('\n').filter((line, i) => line !== patched.split('\n')[i]).length, 2)
fs.writeFileSync(hookPath, patched)

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const eventsInSettings = Object.keys(settings.hooks)
console.log(JSON.stringify({ settingsPath: settingsPath.replace(home, '<HOME>'), events: eventsInSettings }))

async function cdp(expression: string): Promise<unknown> {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
  const target = targets.find(t => t.type === 'page' && t.url.endsWith('index.html'))!
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve))
  return new Promise(resolve => {
    ws.addEventListener('message', event => {
      const data = JSON.parse(String(event.data))
      if (data.id !== 1) return
      ws.close()
      resolve(data.result?.result?.value)
    })
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
}

function runHook(eventName: string, payload: Record<string, unknown>): number | null {
  const entry = settings.hooks[eventName]?.[0]?.hooks?.[0]
  assert.ok(entry?.type === 'command', `no command hook for ${eventName}`)
  const result = spawnSync(entry.command, entry.args ?? [], {
    input: JSON.stringify({ hook_event_name: eventName, ...payload }),
    // Claude Code 會帶自己的環境；這裡只給最小環境，不帶任何帳號或 CLAUDE_* 變數。
    env: { PATH: process.env.PATH ?? '', HOME: home },
    timeout: 10_000,
  })
  return result.status
}

const PEEK = (sessionId: string) => `(async () => {
  await new Promise(r => setTimeout(r, 900))
  const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('agent')
  const c = document.querySelector('canvas[data-animation-action]')
  const s = Object.values(store.sessions).find(x => x.sessionId === ${JSON.stringify(sessionId)})
  return { session: s?.state ?? null, current: store.currentState, pet: store.activePetId, draw: c.dataset.animationAction + '@' + c.dataset.animationRow }
})()`

// 寵物包：刻意混入不合法的值，驗證主程序清理與畫面端回退。
if (withPetPack) {
  const dir = path.join(home, '.desktop-pet', 'custom', 'atlas-pack')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'public/pets/aang-airbender/spritesheet.webp'), path.join(dir, 'spritesheet.webp'))
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({
    id: 'atlas-pack', displayName: 'Atlas Pack', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2, kind: 'person',
    behaviorManifest: {
      idle: { row: 9, frames: 4, frameDurations: [200, 10, 99_999, 150] },
      waving: { row: 3, frameDurations: [140, 'x'] },
      review: { row: 10, frames: 6 },
      running: { row: 40 },
      failed: { row: 2, frames: 99 },
      waiting: { row: -1 },
      walk: { row: 1 },
      bogus: { row: 3 },
    },
  }))
  const loaded = await cdp(`(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('agent')
    await store.loadPets()
    store.setPet('atlas-pack')
    const raw = await window.electronAPI.loadPets()
    await new Promise(r => setTimeout(r, 1500))
    return JSON.stringify(raw.find(p => p.id === 'atlas-pack')?.behaviorManifest ?? null)
  })()`)
  console.log('manifest from main:', loaded)
}

const sessionId = `hook-e2e-${Date.now().toString(36)}`
const base = { session_id: sessionId, cwd: '/tmp/hook-e2e' }
// [hook 事件, payload, 預期 session 狀態, 內建寵物畫的列, 寵物包畫的列]
const steps: Array<[string, Record<string, unknown>, string, string, string]> = [
  ['SessionStart', base, 'idle', 'idle@0', 'idle@9'],
  ['UserPromptSubmit', { ...base, prompt: 'x' }, 'thinking', 'review@8', 'review@10'],
  ['PreToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'ls' } }, 'tool-running', 'running@7', 'running@7'],
  ['PostToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'ls' } }, 'thinking', 'review@8', 'review@10'],
  ['Notification', { ...base, message: 'Claude is waiting for your input' }, 'waiting-input', 'waiting@6', 'waiting@6'],
  ['StopFailure', base, 'error', 'failed@5', 'failed@5'],
  ['Stop', base, 'success', 'jumping@4', 'jumping@4'],
  ['SessionEnd', base, 'offline', 'idle@0', 'idle@9'],
]
let failures = 0
for (const [eventName, payload, expectedState, builtinDraw, packDraw] of steps) {
  const status = runHook(eventName, payload)
  const seen = await cdp(PEEK(sessionId)) as { session: string | null; draw: string }
  const expectedDraw = withPetPack ? packDraw : builtinDraw
  const ok = status === 0 && seen.session === expectedState && seen.draw === expectedDraw
  if (!ok) failures += 1
  console.log(ok ? 'ok  ' : 'FAIL', eventName.padEnd(17), `exit=${status}`, JSON.stringify(seen), ok ? '' : `expected ${expectedState} ${expectedDraw}`)
}
console.log(failures === 0 ? `all ${steps.length} hook events rendered as expected` : `${failures} of ${steps.length} hook events did not match`)
process.exitCode = failures === 0 ? 0 : 1
