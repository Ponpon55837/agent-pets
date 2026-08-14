import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DesktopPreferencesStore,
  parseDesktopPreferencesPatch,
  resolveLoginItemExecutable,
} from '../electron/desktop-preferences.ts'

function tempPreferencesFile(t: test.TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-preferences-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'desktop-preferences.json')
}

test('migrates legacy sound once and persists desktop preferences', (t) => {
  const filePath = tempPreferencesFile(t)
  let openAtLogin = false
  const store = new DesktopPreferencesStore(filePath, {
    supported: true,
    getOpenAtLogin: () => openAtLogin,
    setOpenAtLogin: (enabled) => {
      openAtLogin = enabled
      return openAtLogin
    },
  })

  assert.equal(store.get().soundEnabled, false)
  assert.equal(store.get().permissionBubbleEnabled, true)
  assert.equal(store.get().presentationMcpEnabled, true)
  assert.equal(store.get().achievementsEnabled, true)
  assert.equal(store.get().edgeModeEnabled, false)
  assert.equal(store.get().locale, 'zh-TW')
  assert.equal(store.initializeLegacySound(true).soundEnabled, true)

  const updated = store.update({
    dndEnabled: true,
    permissionBubbleEnabled: false,
    presentationMcpEnabled: false,
    achievementsEnabled: false,
    edgeModeEnabled: true,
    launchAtStartup: true,
    locale: 'en-US',
  })
  assert.equal(updated.dndEnabled, true)
  assert.equal(updated.permissionBubbleEnabled, false)
  assert.equal(updated.presentationMcpEnabled, false)
  assert.equal(updated.achievementsEnabled, false)
  assert.equal(updated.edgeModeEnabled, true)
  assert.equal(updated.launchAtStartup, true)
  assert.equal(updated.locale, 'en-US')

  const reloaded = new DesktopPreferencesStore(filePath, {
    supported: true,
    getOpenAtLogin: () => openAtLogin,
    setOpenAtLogin: enabled => enabled,
  })
  assert.equal(reloaded.get().soundEnabled, true)
  assert.equal(reloaded.get().dndEnabled, true)
  assert.equal(reloaded.get().permissionBubbleEnabled, false)
  assert.equal(reloaded.get().presentationMcpEnabled, false)
  assert.equal(reloaded.get().achievementsEnabled, false)
  assert.equal(reloaded.get().edgeModeEnabled, true)
  assert.equal(reloaded.get().launchAtStartup, true)
  assert.equal(reloaded.get().locale, 'en-US')
})

test('rejects unknown and non-boolean preference fields', () => {
  assert.throws(
    () => parseDesktopPreferencesPatch({ dndEnabled: 'yes' }),
    /must be boolean/,
  )
  assert.throws(
    () => parseDesktopPreferencesPatch({ callbackUrl: 'http://127.0.0.1' }),
    /Unsupported desktop preference/,
  )
  assert.throws(
    () => parseDesktopPreferencesPatch({ locale: 'fr-FR' }),
    /locale is unsupported/,
  )
})

test('keeps launch at startup disabled when the runtime does not support it', (t) => {
  const store = new DesktopPreferencesStore(tempPreferencesFile(t), {
    supported: false,
    getOpenAtLogin: () => true,
    setOpenAtLogin: () => true,
  })

  const updated = store.update({ launchAtStartup: true })
  assert.equal(updated.launchAtStartupSupported, false)
  assert.equal(updated.launchAtStartup, false)
})

test('uses only the original regular portable executable for Windows startup', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-portable-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const portablePath = path.join(directory, 'AgentPets.exe')
  fs.writeFileSync(portablePath, 'test launcher')

  assert.equal(
    resolveLoginItemExecutable('win32', true, 'C:\\Temp\\extracted.exe', portablePath),
    portablePath,
  )
  assert.equal(
    resolveLoginItemExecutable('win32', true, 'C:\\Temp\\extracted.exe', path.join(directory, 'missing.exe')),
    null,
  )
  assert.equal(resolveLoginItemExecutable('win32', false, portablePath, portablePath), null)
})
