#!/usr/bin/env node

/**
 * install.mjs - One-click installer for Agent Pets integrations
 *
 * Usage:
 *   node integrations/install.mjs                  # install all
 *   node integrations/install.mjs --opencode       # install OpenCode plugin only
 *   node integrations/install.mjs --codex          # install Codex hooks only
 *   node integrations/install.mjs --claude         # install Claude Desktop config only
 *   node integrations/install.mjs --claude-code    # install Claude Code (CLI & Desktop) hooks only
 *   node integrations/install.mjs --all            # install all (default)
 *
 * Uninstall:
 *   node integrations/install.mjs --uninstall      # remove all
 *   node integrations/install.mjs --uninstall --codex   # remove Codex hooks only
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// GUI apps (Codex Desktop, Claude Desktop, ...) launched from Finder/Dock get
// launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) — it doesn't include
// Homebrew or nvm, so a bare "node" in a hook command silently fails to even
// start. Resolve an absolute path once at install time instead: ask a login
// shell (which sources the user's real PATH) where node actually is. Falls
// back to common install locations, then the bare command as a last resort.
let cachedNodeBin = null
function resolveNodeBin() {
  if (IS_WIN) return process.execPath
  if (cachedNodeBin) return cachedNodeBin

  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-ilc', 'command -v node'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    const resolved = out.split('\n').pop()?.trim()
    if (resolved && fs.existsSync(resolved)) {
      cachedNodeBin = resolved
      return resolved
    }
  } catch {}

  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (fs.existsSync(candidate)) {
      cachedNodeBin = candidate
      return candidate
    }
  }

  return 'node'
}
const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SessionEnd',
]
const CLAUDE_CODE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
]
const CLAUDE_CODE_TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse'])

function homeDir() {
  return os.homedir()
}

// ── OpenCode paths ──
// OpenCode scans "plugin" (singular), not "plugins" — confirmed against a
// real install where its own bundled plugins live in ~/.config/opencode/plugin/.
function openCodeCliPluginDir() {
  return path.join(homeDir(), '.config', 'opencode', 'plugin')
}

function openCodeDesktopPluginDir() {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'plugin')
  }
  // Windows
  return path.join(process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming'), 'opencode', 'plugin')
}

// ── Codex paths ──
function codexDir() {
  return path.join(homeDir(), '.codex')
}

function codexHooksPath() {
  return path.join(codexDir(), 'hooks.json')
}

function codexConfigPath() {
  return path.join(codexDir(), 'config.toml')
}

// ── Claude Desktop paths ──
function claudeDesktopDir() {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'Claude')
  }
  return path.join(process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming'), 'Claude')
}

function claudeDesktopConfigPath() {
  return path.join(claudeDesktopDir(), 'claude_desktop_config.json')
}

// ── Claude Code paths (CLI & Desktop share the same hook config) ──
function claudeCodeDir() {
  return path.join(homeDir(), '.claude')
}

function claudeCodeSettingsPath() {
  return path.join(claudeCodeDir(), 'settings.json')
}

// ── Hook script ──
function hookDeployDir() {
  return path.join(homeDir(), '.desktop-pet')
}

function hookScriptPath() {
  return path.join(hookDeployDir(), 'agent-hook.mjs')
}

function hookWrapperPath() {
  return path.join(hookDeployDir(), 'agent-hook.cmd')
}

function eventTokenPath() {
  return path.join(hookDeployDir(), 'event-token')
}

function ensureEventToken() {
  const dir = hookDeployDir()
  ensureDir(dir)
  if (!IS_WIN) {
    try { fs.chmodSync(dir, 0o700) } catch {}
  }
  const tokenPath = eventTokenPath()
  if (fs.existsSync(tokenPath)) {
    const stat = fs.lstatSync(tokenPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Agent Pets event token path is not a regular file')
    }
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (/^[a-f0-9]{64}$/i.test(existing)) {
      if (!IS_WIN) {
        try { fs.chmodSync(tokenPath, 0o600) } catch {}
      }
      return existing
    }
  }
  const token = randomBytes(32).toString('hex')
  fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  if (!IS_WIN) {
    try { fs.chmodSync(tokenPath, 0o600) } catch {}
  }
  return token
}

function hookScriptContent() {
  return fs.readFileSync(new URL('./agent-hook.mjs', import.meta.url), 'utf-8')
}

function hookWrapperContent() {
  return fs
    .readFileSync(new URL('./agent-hook.cmd', import.meta.url), 'utf-8')
    .replace('__NODE_EXECUTABLE__', process.execPath)
}

// ── File helpers ──
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function writeFileEnsured(filePath, content) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`  ✓ wrote ${filePath}`)
}

function appendToFile(filePath, line) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
  if (existing.includes(line.trim())) {
    console.log(`  ✓ already present: ${line.trim()}`)
    return
  }
  const sep = existing.endsWith('\n') || existing.length === 0 ? '' : '\n'
  fs.writeFileSync(filePath, existing + sep + line + '\n', 'utf-8')
  console.log(`  ✓ appended to ${filePath}`)
}

function removeFromFile(filePath, line) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf-8')
  const filtered = content.split('\n').filter(l => l.trim() !== line.trim())
  fs.writeFileSync(filePath, filtered.join('\n'), 'utf-8')
  console.log(`  ✓ removed from ${filePath}`)
}

function enableCodexHooksFeature(filePath) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
  const lines = existing
    .split(/\r?\n/)
    .filter(line => !/^\s*codex_hooks\s*=/.test(line))

  const featuresIndex = lines.findIndex(line => /^\s*\[features\]\s*$/.test(line))

  if (featuresIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
      lines.push('')
    }
    lines.push('[features]')
    lines.push('hooks = true')
  } else {
    let insertIndex = featuresIndex + 1
    let hooksIndex = -1

    for (let i = featuresIndex + 1; i < lines.length; i++) {
      if (/^\s*\[/.test(lines[i])) break
      insertIndex = i + 1
      if (/^\s*hooks\s*=/.test(lines[i])) {
        hooksIndex = i
      }
    }

    if (hooksIndex === -1) {
      lines.splice(insertIndex, 0, 'hooks = true')
    } else {
      lines[hooksIndex] = 'hooks = true'
    }
  }

  fs.writeFileSync(filePath, lines.join('\n').replace(/\n*$/, '\n'), 'utf-8')
  console.log(`  ✓ enabled [features].hooks in ${filePath}`)
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    console.log(`  ✓ removed ${filePath}`)
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath)
}

function addJsonKey(filePath, key, value) {
  if (!fs.existsSync(filePath)) return
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  if (content[key] === value) {
    console.log(`  ✓ ${key} already set in ${filePath}`)
    return
  }
  content[key] = value
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8')
  console.log(`  ✓ set ${key} in ${filePath}`)
}

function removeJsonKey(filePath, key) {
  if (!fs.existsSync(filePath)) return
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  if (!(key in content)) return
  delete content[key]
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8')
  console.log(`  ✓ removed ${key} from ${filePath}`)
}

// ── Codex hooks template ──
function codexHooksJson() {
  const hook = hookScriptPath()
  const nodeBin = resolveNodeBin()
  const command = IS_WIN ? `${hookWrapperPath()} codex` : `${nodeBin} "${hook}" codex`
  const handler = () => ({
    hooks: [
      {
        type: 'command',
        command,
        statusMessage: 'Updating Agent Pets status',
      },
    ],
  })

  return {
    description: 'Agent Pets lifecycle hooks for Codex CLI.',
    hooks: {
      ...Object.fromEntries(CODEX_HOOK_EVENTS.map((event) => [event, [handler()]])),
    }
  }
}

// ── Claude Code hooks template ──
// Windows can't run .cmd/.bat files in "exec form" (command + args, no shell),
// so unlike Codex's shell-form single string, Claude Code's hooks call node
// directly with an args array — see https://code.claude.com/docs/en/hooks
// ("Windows-Specific Execution Issues").
function claudeCodeHooksJson() {
  const hook = hookScriptPath()
  const nodeBin = resolveNodeBin()
  const handler = (event) => {
    const entry = { hooks: [{ type: 'command', command: nodeBin, args: [hook, 'claude'] }] }
    if (CLAUDE_CODE_TOOL_EVENTS.has(event)) entry.matcher = '*'
    return entry
  }

  return {
    hooks: Object.fromEntries(CLAUDE_CODE_HOOK_EVENTS.map((event) => [event, [handler(event)]])),
  }
}

function isAgentPetsHook(hook) {
  if (hook?.type !== 'command') return false
  const command = typeof hook.command === 'string' ? hook.command : ''
  const args = Array.isArray(hook.args) ? hook.args.join(' ') : ''
  const combined = `${command} ${args}`
  return combined.includes('agent-hook') && combined.includes('desktop-pet')
}

function removeAgentPetsHooks(groups) {
  if (!Array.isArray(groups)) return []
  return groups
    .map((group) => {
      if (!Array.isArray(group?.hooks)) return group
      return {
        ...group,
        hooks: group.hooks.filter((hook) => !isAgentPetsHook(hook)),
      }
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0)
}

// ── Install functions ──
function installHookScript() {
  console.log('\n📦 Installing hook script...')
  ensureEventToken()
  const dir = hookDeployDir()
  ensureDir(dir)
  writeFileEnsured(hookScriptPath(), hookScriptContent())
  if (IS_WIN) {
    writeFileEnsured(hookWrapperPath(), hookWrapperContent())
  }
  if (!IS_WIN) {
    try { fs.chmodSync(hookScriptPath(), 0o700) } catch {}
  }
}

function installOpenCode() {
  console.log('\n📦 Installing OpenCode Desktop plugin...')
  ensureEventToken()

  // Desktop
  const desktopDir = openCodeDesktopPluginDir()
  ensureDir(desktopDir)
  const desktopPluginPath = path.join(desktopDir, 'desktop-pet.js')
  // OpenCode's real plugin shape: an (async) function receiving a context
  // object that returns a hooks object. Tool lifecycle hooks are direct keys;
  // session lifecycle notifications arrive through the generic `event` hook.
  // There's no direct "user prompt submitted" hook, so the pet won't show
  // "thinking" until the first tool call — a known gap, not a bug.
  const pluginContent = `import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sessionId = 'opencode-' + process.pid + '-' + Date.now();
const eventTokenPath = path.join(os.homedir(), '.desktop-pet', 'event-token');
let currentState = null;
let stateTimer = null;

function readEventToken() {
  try { return fs.readFileSync(eventTokenPath, 'utf8').trim(); } catch { return ''; }
}

function sendEvent(state, toolName) {
  const eventToken = readEventToken();
  if (!eventToken) return;
  const payload = JSON.stringify({
    source: 'opencode-desktop',
    sessionId,
    state,
    timestamp: Date.now(),
    toolName,
  });
  const req = http.request({
    hostname: '127.0.0.1',
    port: 17373,
    path: '/v1/events',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Agent-Pets-Token': eventToken,
    }
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();
}

function setState(state, toolName) {
  if (state === currentState) return;
  currentState = state;
  if (stateTimer) clearTimeout(stateTimer);
  if (state === 'success' || state === 'error') {
    stateTimer = setTimeout(() => { currentState = null; }, 4000);
  }
  sendEvent(state, toolName);
}

const DesktopPetPlugin = async () => ({
  'tool.execute.before': async (input) => { setState('tool-running', input && input.tool); },
  'tool.execute.after': async () => { setState('thinking'); },
  // OpenCode lifecycle notifications arrive through the generic event hook.
  // They are not direct hook keys in the current plugin API.
  event: async ({ event }) => {
    if (event.type === 'session.status') {
      if (event.properties.status.type === 'busy') setState('thinking');
      if (event.properties.status.type === 'retry') setState('thinking');
      if (event.properties.status.type === 'idle') setState('idle');
    } else if (event.type === 'session.idle') {
      setState('idle');
    } else if (event.type === 'session.error') {
      setState('error');
    }
  },
});

export default DesktopPetPlugin;
export { DesktopPetPlugin };
`
  writeFileEnsured(desktopPluginPath, pluginContent)

  // CLI
  const cliDir = openCodeCliPluginDir()
  ensureDir(cliDir)
  const cliPluginPath = path.join(cliDir, 'desktop-pet.js')
  const cliPluginContent = pluginContent.replace("source: 'opencode-desktop'", "source: 'opencode-cli'")
  writeFileEnsured(cliPluginPath, cliPluginContent)
}

function installCodex() {
  console.log('\n📦 Installing Codex integration...')
  installHookScript()

  const hooksFile = codexHooksPath()
  ensureDir(codexDir())

  const newHooks = codexHooksJson()
  if (fileExists(hooksFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(hooksFile, 'utf-8'))
      existing.hooks = existing.hooks || {}
      for (const [event, arr] of Object.entries(newHooks.hooks)) {
        delete existing[event]
        existing.hooks[event] = removeAgentPetsHooks(existing.hooks[event])
        if (!existing.hooks[event] || existing.hooks[event].length === 0) {
          existing.hooks[event] = arr
        } else {
          existing.hooks[event].push(arr[0])
        }
      }
      writeFileEnsured(hooksFile, JSON.stringify(existing, null, 2))
    } catch {
      writeFileEnsured(hooksFile, JSON.stringify(newHooks, null, 2))
    }
  } else {
    writeFileEnsured(hooksFile, JSON.stringify(newHooks, null, 2))
  }

  const configFile = codexConfigPath()
  if (fileExists(configFile)) {
    enableCodexHooksFeature(configFile)
  } else {
    writeFileEnsured(configFile, '[features]\nhooks = true\n')
  }
}

function installClaude() {
  console.log('\n📦 Installing Claude Desktop integration...')
  installHookScript()

  const configFile = claudeDesktopConfigPath()
  ensureDir(claudeDesktopDir())

  if (!fileExists(configFile)) {
    writeFileEnsured(configFile, '{}')
  }

  addJsonKey(configFile, 'agent', hookScriptPath())
}

function installClaudeCode() {
  console.log('\n📦 Installing Claude Code (CLI & Desktop) integration...')
  installHookScript()

  const settingsFile = claudeCodeSettingsPath()
  ensureDir(claudeCodeDir())

  const newHooks = claudeCodeHooksJson()
  let existing = {}
  if (fileExists(settingsFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
    } catch {
      existing = {}
    }
  }

  existing.hooks = existing.hooks || {}
  for (const [event, arr] of Object.entries(newHooks.hooks)) {
    existing.hooks[event] = removeAgentPetsHooks(existing.hooks[event])
    if (!existing.hooks[event] || existing.hooks[event].length === 0) {
      existing.hooks[event] = arr
    } else {
      existing.hooks[event].push(arr[0])
    }
  }

  writeFileEnsured(settingsFile, JSON.stringify(existing, null, 2))
}

function installAll() {
  console.log('🐾 Agent Pets - Integration Installer\n')
  installOpenCode()
  installCodex()
  installClaude()
  installClaudeCode()
  console.log('\n✅ All integrations installed! Restart your coding tools for changes to take effect.\n')
}

// ── Uninstall functions ──
function uninstallOpenCode() {
  console.log('\n🗑️  Removing OpenCode plugin...')
  removeFile(path.join(openCodeDesktopPluginDir(), 'desktop-pet.js'))
  removeFile(path.join(openCodeCliPluginDir(), 'desktop-pet.js'))
}

function uninstallCodex() {
  console.log('\n🗑️  Removing Codex integration...')
  removeFile(hookScriptPath())

  const hooksFile = codexHooksPath()
  if (fileExists(hooksFile)) {
    removeFile(hooksFile)
  }

  const configFile = codexConfigPath()
  if (fileExists(configFile)) {
    removeFromFile(configFile, 'codex_hooks = true')
  }
}

function uninstallClaude() {
  console.log('\n🗑️  Removing Claude Desktop integration...')
  removeFile(hookScriptPath())

  const configFile = claudeDesktopConfigPath()
  if (fileExists(configFile)) {
    removeJsonKey(configFile, 'agent')
  }
}

function uninstallClaudeCode() {
  console.log('\n🗑️  Removing Claude Code (CLI & Desktop) integration...')

  const settingsFile = claudeCodeSettingsPath()
  if (fileExists(settingsFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
      if (existing.hooks && typeof existing.hooks === 'object') {
        for (const event of Object.keys(existing.hooks)) {
          existing.hooks[event] = removeAgentPetsHooks(existing.hooks[event])
          if (!existing.hooks[event] || existing.hooks[event].length === 0) {
            delete existing.hooks[event]
          }
        }
        if (Object.keys(existing.hooks).length === 0) {
          delete existing.hooks
        }
      }
      writeFileEnsured(settingsFile, JSON.stringify(existing, null, 2))
      console.log(`  ✓ removed Agent Pets hooks from ${settingsFile}`)
    } catch {
      // malformed settings.json, leave untouched
    }
  }
}

function uninstallAll() {
  console.log('🗑️  Agent Pets - Uninstalling integrations...\n')
  uninstallOpenCode()
  uninstallCodex()
  uninstallClaude()
  uninstallClaudeCode()
  console.log('\n✅ All integrations removed. Restart your coding tools for changes to take effect.\n')
}

// ── CLI ──
const args = process.argv.slice(2)
const isUninstall = args.includes('--uninstall')
const target = args.find(a => a.startsWith('--') && a !== '--uninstall')

if (isUninstall) {
  switch (target) {
    case '--opencode': uninstallOpenCode(); break
    case '--codex': uninstallCodex(); break
    case '--claude': uninstallClaude(); break
    case '--claude-code': uninstallClaudeCode(); break
    default: uninstallAll(); break
  }
} else {
  switch (target) {
    case '--opencode': installOpenCode(); break
    case '--codex': installCodex(); break
    case '--claude': installClaude(); break
    case '--claude-code': installClaudeCode(); break
    default: installAll(); break
  }
}
