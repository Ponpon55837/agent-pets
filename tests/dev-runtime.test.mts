import assert from 'node:assert/strict'
import test from 'node:test'
import { electronDevArgv, electronDevEnvironment } from '../vite.config.mts'
import { shouldDisableDevHardwareAcceleration } from '../electron/dev-runtime.ts'

test('Electron dev startup preserves Chromium sandboxing', () => {
  assert.deepEqual(electronDevArgv(), ['.'])
  assert.equal(electronDevArgv().includes('--no-sandbox'), false)
})

test('Electron dev startup passes a machine-local GPU preference without mutating its source', () => {
  const source = {
    VITE_DEV_SERVER_URL: 'http://localhost:5173',
    AGENT_PETS_DISABLE_GPU: 'stale',
  }
  const enabled = electronDevEnvironment(source, true)
  const disabled = electronDevEnvironment(source, false)

  assert.notEqual(enabled, source)
  assert.equal(enabled.VITE_DEV_SERVER_URL, source.VITE_DEV_SERVER_URL)
  assert.equal(enabled.AGENT_PETS_DISABLE_GPU, '1')
  assert.equal('AGENT_PETS_DISABLE_GPU' in disabled, false)
  assert.equal(source.AGENT_PETS_DISABLE_GPU, 'stale')
})

test('hardware acceleration fallback requires an explicit Windows Vite dev preference', () => {
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', false, 'http://localhost:5173', '1'),
    true,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', false, 'http://localhost:5173', undefined),
    false,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', false, 'http://localhost:5173', '0'),
    false,
  )
  assert.equal(shouldDisableDevHardwareAcceleration('win32', false, undefined, '1'), false)
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', true, 'http://localhost:5173', '1'),
    false,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('darwin', false, 'http://localhost:5173', '1'),
    false,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('linux', false, 'http://localhost:5173', '1'),
    false,
  )
})
