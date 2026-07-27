#!/usr/bin/env node

/**
 * install.mjs - One-click installer for Agent Pets integrations
 *
 * Usage:
 *   node integrations/install.mjs                  # install all
 *   node integrations/install.mjs --opencode       # install OpenCode plugin only
 *   node integrations/install.mjs --codex          # install Codex hooks only
 *   node integrations/install.mjs --claude         # install Claude hooks only
 *   node integrations/install.mjs --all            # install all (default)
 *
 * Uninstall:
 *   node integrations/install.mjs --uninstall      # remove all
 *   node integrations/install.mjs --uninstall --codex   # remove Codex hooks only
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

function homeDir() {
  return os.homedir()
}

// ── OpenCode paths ──
function openCodeCliPluginDir() {
  return path.join(homeDir(), '.config', 'opencode', 'plugins')
}

function openCodeDesktopPluginDir() {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'plugins')
  }
  // Windows
  return path.join(process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming'), 'opencode', 'plugins')
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

// ── Hook script ──
function hookDeployDir() {
  return path.join(homeDir(), '.desktop-pet')
}

function hookScriptPath() {
  return path.join(hookDeployDir(), 'agent-hook.mjs')
}

function hookScriptContent() {
  return `#!/usr/bin/env node
import fs from 'fs';
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => input += d);
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const tool = event.tool || 'unknown';
    const args = event.args || {};
    const method = (args.method || '').toLowerCase();

    let petState;
    if (tool === 'shell' && (method === 'exec' || method === 'spawn')) {
      petState = 'tool-running';
    } else if (['webfetch', 'websearch', 'codesearch', 'grep', 'glob', 'read'].includes(tool)) {
      petState = 'tool-running';
    } else if (['write', 'edit', 'patch'].includes(tool)) {
      petState = 'tool-running';
    } else if (method.includes('permission') || method.includes('grant')) {
      petState = 'waiting';
    } else {
      petState = 'thinking';
    }

    const state = args.state || petState;
    const hookType = process.argv[2] || 'codex';
    const hookEvent = process.argv[3] || 'unknown';

    if (hookType === 'codex' && hookEvent === 'SessionStart') {
      // nothing
    }

    const payload = JSON.stringify({ source: hookType, state, tool, args });

    const req = new (await import('http')).default.request({
      hostname: '127.0.0.1',
      port: 17373,
      path: '/v1/events',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => { process.exit(0); });
    req.on('error', () => process.exit(0));
    req.write(payload);
    req.end();
  } catch (e) {
    process.exit(0);
  }
});
`
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
  const nodeBin = IS_WIN ? 'node' : 'node'
  return {
    hooks: {
      PreToolUse: [{ type: 'command', command: `${nodeBin} "${hook}" codex PreToolUse` }],
      PostToolUse: [{ type: 'command', command: `${nodeBin} "${hook}" codex PostToolUse` }],
      Notification: [{ type: 'command', command: `${nodeBin} "${hook}" codex Notification` }],
    }
  }
}

// ── Install functions ──
function installHookScript() {
  console.log('\n📦 Installing hook script...')
  const dir = hookDeployDir()
  ensureDir(dir)
  writeFileEnsured(hookScriptPath(), hookScriptContent())
  if (!IS_WIN) {
    try { fs.chmodSync(hookScriptPath(), 0o700) } catch {}
  }
}

function installOpenCode() {
  console.log('\n📦 Installing OpenCode Desktop plugin...')

  // Desktop
  const desktopDir = openCodeDesktopPluginDir()
  ensureDir(desktopDir)
  const desktopPluginPath = path.join(desktopDir, 'desktop-pet.mjs')
  const pluginContent = `import http from 'http';

const PET_STATES = ['thinking', 'tool-running', 'waiting', 'success', 'error'];
let currentState = null;
let stateTimer = null;

function sendEvent(state) {
  const payload = JSON.stringify({ source: 'opencode-desktop', state });
  const req = http.request({
    hostname: '127.0.0.1',
    port: 17373,
    path: '/v1/events',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();
}

function setState(state) {
  if (state === currentState) return;
  currentState = state;
  if (stateTimer) clearTimeout(stateTimer);
  if (state === 'success' || state === 'error') {
    stateTimer = setTimeout(() => { currentState = null; }, 4000);
  }
  sendEvent(state);
}

export default function desktopPetPlugin({ eventBus }) {
  eventBus.on('session.start', () => { setState('thinking'); });
  eventBus.on('message.send', () => { setState('thinking'); });
  eventBus.on('tool.call', () => { setState('tool-running'); });
  eventBus.on('tool.result', () => { setState('success'); });
  eventBus.on('session.end', () => { setState('idle'); });
}
`
  writeFileEnsured(desktopPluginPath, pluginContent)

  // CLI
  const cliDir = path.join(homeDir(), '.config', 'opencode', 'plugins')
  ensureDir(cliDir)
  const cliPluginPath = path.join(cliDir, 'desktop-pet.mjs')
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
        if (!existing.hooks[event]) {
          existing.hooks[event] = arr
        } else {
          const existingCmds = existing.hooks[event].map(h => h.command)
          for (const hook of arr) {
            if (!existingCmds.includes(hook.command)) {
              existing.hooks[event].push(hook)
            }
          }
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
    appendToFile(configFile, 'codex_hooks = true')
  } else {
    writeFileEnsured(configFile, 'codex_hooks = true\n')
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

function installAll() {
  console.log('🐾 Agent Pets - Integration Installer\n')
  installOpenCode()
  installCodex()
  installClaude()
  console.log('\n✅ All integrations installed! Restart your coding tools for changes to take effect.\n')
}

// ── Uninstall functions ──
function uninstallOpenCode() {
  console.log('\n🗑️  Removing OpenCode plugin...')
  removeFile(path.join(openCodeDesktopPluginDir(), 'desktop-pet.mjs'))
  removeFile(path.join(openCodeCliPluginDir(), 'desktop-pet.mjs'))
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

function uninstallAll() {
  console.log('🗑️  Agent Pets - Uninstalling integrations...\n')
  uninstallOpenCode()
  uninstallCodex()
  uninstallClaude()
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
    default: uninstallAll(); break
  }
} else {
  switch (target) {
    case '--opencode': installOpenCode(); break
    case '--codex': installCodex(); break
    case '--claude': installClaude(); break
    default: installAll(); break
  }
}
