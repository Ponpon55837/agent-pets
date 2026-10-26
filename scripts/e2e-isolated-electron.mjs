#!/usr/bin/env node
// Test-only launcher: starts the built app in a throw-away HOME and userData, with a
// fake safeStorage installed BEFORE any app code runs, so automated runs never touch
// the user's real data or macOS Keychain. Usage:
//   pnpm exec vite build
//   node scripts/e2e-isolated-electron.mjs [--inspect-port 9349] [--debug-port 9348] [--app-root <dir>]
// --app-root runs another copy of the app (e.g. an extracted packaged app.asar) instead of this repo.
// Prints one JSON line with the temp root, ports and pid, then keeps running.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const repoRoot = resolve(import.meta.dirname, '..')
const argString = name => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null
}
const argValue = (name, fallback) => {
  const value = argString(name)
  return value ? Number(value) : fallback
}
const inspectPort = argValue('--inspect-port', 9349)
const debugPort = argValue('--debug-port', 9348)
const appRoot = resolve(argString('--app-root') ?? repoRoot)
const mainBundle = join(appRoot, 'dist-electron', 'main.js')
if (!existsSync(mainBundle)) {
  console.error(`${mainBundle} not found; run \`pnpm exec vite build\` first (or check --app-root)`)
  process.exit(1)
}

const root = mkdtempSync(join(tmpdir(), 'agent-pets-e2e-'))
mkdirSync(join(root, 'home'))
mkdirSync(join(root, 'ud'))
const bootstrap = join(root, 'bootstrap.cjs')
writeFileSync(bootstrap, `
const path = require('node:path')
const { app, safeStorage } = require('electron')
const root = ${JSON.stringify(root)}
const userData = path.join(root, 'ud')
app.setPath('userData', userData)
if (typeof app.setAppPath === 'function') app.setAppPath(${JSON.stringify(appRoot)})
const calls = { isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }
safeStorage.isEncryptionAvailable = () => { calls.isEncryptionAvailable += 1; return true }
safeStorage.encryptString = (value) => { calls.encryptString += 1; return Buffer.from('agent-pets-e2e:' + value, 'utf8') }
safeStorage.decryptString = (value) => {
  calls.decryptString += 1
  const text = Buffer.from(value).toString('utf8')
  if (!text.startsWith('agent-pets-e2e:')) throw new Error('not an e2e ciphertext')
  return text.slice('agent-pets-e2e:'.length)
}
const fake = safeStorage.encryptString.toString().includes('agent-pets-e2e')
  && safeStorage.decryptString.toString().includes('agent-pets-e2e')
  && safeStorage.isEncryptionAvailable.toString().includes('calls')
const isolated = app.getPath('userData') === userData && require('node:os').homedir() === path.join(root, 'home')
if (!fake || !isolated) {
  console.error('AGENT_PETS_E2E_ABORT fake=' + fake + ' isolated=' + isolated)
  process.exit(1)
}
globalThis.__agentPetsE2E = {
  root,
  userData,
  calls,
  panelViewBlockedRequests: 0,
}
console.log('AGENT_PETS_E2E_READY ' + JSON.stringify({ root, userData: app.getPath('userData'), home: require('node:os').homedir(), fakeSafeStorage: fake }))
require(${JSON.stringify(mainBundle)})
`)

const electronBinary = createRequire(import.meta.url)('electron')
const child = spawn(electronBinary, [
  `--inspect=${inspectPort}`,
  `--remote-debugging-port=${debugPort}`,
  bootstrap,
], {
  cwd: repoRoot,
  env: { ...process.env, HOME: join(root, 'home') },
  stdio: ['ignore', 'inherit', 'inherit'],
})
console.log(JSON.stringify({ root, appRoot, inspectPort, debugPort, pid: child.pid }))
child.on('exit', code => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
