import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activateWindowsApp,
  activateWindowsHost,
  createNativeWindowsApi,
  isAllowedWindowsExecutable,
  type WindowsWindowApi,
} from '../electron/windows-window-activator.ts'
import { HOST_APPS, windowsExecutablesFor } from '../src/types/host-app.ts'

// 原生層全部是假的：這些測試絕不呼叫 Win32，也不載入 koffi。

interface FakeWindow {
  id: number
  pid: number
  visible?: boolean
  cloaked?: boolean
  minimized?: boolean
  tool?: boolean
  owner?: boolean
}

function fakeApi(windows: FakeWindow[], images: Record<number, string | null>, options: { foregroundSticks?: boolean; attachWorks?: boolean; throwOn?: string } = {}) {
  const log: string[] = []
  let foreground: unknown = 999
  const byId = (handle: unknown) => windows.find(window => window.id === handle)!
  const guard = (name: string) => { if (options.throwOn === name) throw new Error(`${name} failed`) }
  let attached = false
  const api: WindowsWindowApi = {
    topWindow: () => windows[0]?.id ?? null,
    nextWindow: handle => windows[windows.findIndex(window => window.id === handle) + 1]?.id ?? null,
    isVisible: handle => byId(handle).visible ?? true,
    isCloaked: handle => byId(handle).cloaked ?? false,
    isMinimized: handle => byId(handle).minimized ?? false,
    isToolWindow: handle => byId(handle).tool ?? false,
    hasOwner: handle => byId(handle).owner ?? false,
    processId: handle => byId(handle).pid,
    imagePath: pid => { guard('imagePath'); return images[pid] ?? null },
    restore: handle => { log.push(`restore:${String(handle)}`) },
    setForeground: handle => {
      guard('setForeground')
      log.push(`foreground:${String(handle)}${attached ? ':attached' : ''}`)
      if (options.foregroundSticks === false && !attached) return false
      foreground = handle
      return true
    },
    foregroundWindow: () => foreground,
    threadId: () => 77,
    currentThreadId: () => 11,
    attachThreadInput: (_from, _to, attach) => { attached = attach; log.push(attach ? 'attach' : 'detach'); return options.attachWorks !== false },
  }
  return { api, log, foreground: () => foreground }
}

test('executable match is a case-insensitive, exact basename match', () => {
  const allowed = ['code.exe']
  assert.equal(isAllowedWindowsExecutable('C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', allowed), true)
  assert.equal(isAllowedWindowsExecutable('C:\\X\\CODE.EXE', allowed), true)
  // 只看 basename：目錄不同仍通過，因為效果只是把該使用者自己的視窗帶到前景。
  assert.equal(isAllowedWindowsExecutable('C:\\evil\\Code.exe', allowed), true)
  for (const bad of ['C:\\x\\Code.exe.evil', 'C:\\x\\Code.exe ', 'C:\\x\\xCode.exe', 'C:\\x\\Code.exe\\child.exe', '', null, 'Code', `C:\\${'a'.repeat(2000)}\\Code.exe`, `C:\\${'a'.repeat(80)}.exe`]) {
    assert.equal(isAllowedWindowsExecutable(bad as string | null, allowed), false, String(bad))
  }
  assert.equal(isAllowedWindowsExecutable('C:\\x\\Code.exe', []), false)
})

test('the Windows executable allowlist is lowercase, unique, bare file names', () => {
  const seen = new Set<string>()
  for (const [id, definition] of Object.entries(HOST_APPS)) {
    for (const name of definition.windowsExecutables ?? []) {
      assert.equal(name, name.toLowerCase(), id)
      assert.match(name, /^[a-z0-9][a-z0-9 ._-]*\.exe$/, id)
      assert.equal(seen.has(name), false, `${id} duplicates ${name}`)
      seen.add(name)
    }
  }
  assert.deepEqual(windowsExecutablesFor('windows-terminal'), ['windowsterminal.exe'])
  assert.deepEqual(windowsExecutablesFor('vscode-insiders'), ['code - insiders.exe'])
  assert.deepEqual(windowsExecutablesFor('unknown'), [])
  assert.deepEqual(windowsExecutablesFor(undefined), [])
  assert.deepEqual(windowsExecutablesFor('iterm2'), [])
})

test('picks the topmost visible, uncloaked, ownerless window of an allowed process and activates it', () => {
  const { api, log, foreground } = fakeApi(
    [
      { id: 1, pid: 10 },
      { id: 2, pid: 20, visible: false },
      { id: 3, pid: 20, cloaked: true },
      { id: 4, pid: 20, tool: true },
      { id: 5, pid: 20, owner: true },
      { id: 6, pid: 20 },
      { id: 7, pid: 20 },
    ],
    { 10: 'C:\\Windows\\explorer.exe', 20: 'C:\\Program Files\\WindowsTerminal.exe' },
  )
  assert.equal(activateWindowsHost(api, ['windowsterminal.exe']), 'activated')
  assert.equal(foreground(), 6)
  assert.deepEqual(log, ['foreground:6'])
})

test('a minimized window is restored first; no match means not_found; unknown images are skipped', () => {
  const minimized = fakeApi([{ id: 1, pid: 20, minimized: true }], { 20: 'C:\\a\\Code.exe' })
  assert.equal(activateWindowsHost(minimized.api, ['code.exe']), 'activated')
  assert.deepEqual(minimized.log, ['restore:1', 'foreground:1'])

  const none = fakeApi([{ id: 1, pid: 10 }, { id: 2, pid: 30 }], { 10: 'C:\\a\\notepad.exe', 30: null })
  assert.equal(activateWindowsHost(none.api, ['code.exe']), 'not_found')
  assert.deepEqual(none.log, [])
  assert.equal(activateWindowsHost(fakeApi([], {}).api, ['code.exe']), 'not_found')
  assert.equal(activateWindowsHost(minimized.api, []), 'not_found')
})

test('foreground lock falls back to one attach/detach retry and reports failed when it still does not stick', () => {
  const recovers = fakeApi([{ id: 1, pid: 20 }], { 20: 'C:\\a\\Code.exe' }, { foregroundSticks: false })
  assert.equal(activateWindowsHost(recovers.api, ['code.exe']), 'activated')
  assert.deepEqual(recovers.log, ['foreground:1', 'attach', 'foreground:1:attached', 'detach'])

  const refused = fakeApi([{ id: 1, pid: 20 }], { 20: 'C:\\a\\Code.exe' }, { foregroundSticks: false, attachWorks: false })
  assert.equal(activateWindowsHost(refused.api, ['code.exe']), 'failed')
  assert.ok(!refused.log.includes('detach'))
})

test('a throwing native layer fails safe instead of throwing', () => {
  for (const throwOn of ['imagePath', 'setForeground']) {
    const { api } = fakeApi([{ id: 1, pid: 20 }], { 20: 'C:\\a\\Code.exe' }, { throwOn })
    assert.equal(activateWindowsHost(api, ['code.exe']), 'failed', throwOn)
  }
})

test('a cyclic window chain terminates', () => {
  const api = fakeApi([{ id: 1, pid: 10 }], { 10: 'C:\\a\\other.exe' }).api
  const looping: WindowsWindowApi = { ...api, nextWindow: () => 1 }
  assert.equal(activateWindowsHost(looping, ['code.exe']), 'not_found')
})

test('koffi is never loaded off Windows and activation then fails safe', async () => {
  assert.equal(createNativeWindowsApi('darwin'), null)
  assert.equal(createNativeWindowsApi('linux'), null)
  if (process.platform !== 'win32') assert.equal(await activateWindowsApp(['code.exe']), 'failed')
  const { api } = fakeApi([{ id: 1, pid: 20 }], { 20: 'C:\\a\\Code.exe' })
  assert.equal(await activateWindowsApp(['code.exe'], api), 'activated')
})
