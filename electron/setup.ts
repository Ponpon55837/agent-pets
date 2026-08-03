import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFileSync } from 'child_process'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

function homeDir(): string {
  return os.homedir()
}

function appDataDir(): string {
  return app.getPath('userData')
}

// GUI apps (Codex Desktop, Claude Desktop, ...) launched from Finder/Dock get
// launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) — it doesn't include
// Homebrew or nvm, so a bare "node" in a hook command silently fails to even
// start. Resolve an absolute path once at install time instead: ask a login
// shell (which sources the user's real PATH) where node actually is, same
// fix GUI apps commonly need (e.g. the "fix-path" pattern). Falls back to
// common install locations, then the bare command as a last resort.
let cachedNodeBin: string | null = null
function resolveNodeBin(): string {
  if (cachedNodeBin) return cachedNodeBin

  if (IS_WIN) {
    // In a packaged Electron app, process.execPath is Agent Pets.exe, not
    // node.exe. Using it for hooks launches another pet for every lifecycle
    // event. Prefer standard Node.js locations, then the user's PATH.
    const candidates = [
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe') : '',
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe') : '',
    ].filter(Boolean)

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        cachedNodeBin = candidate
        return candidate
      }
    }

    try {
      const out = execFileSync('where.exe', ['node.exe'], {
        encoding: 'utf-8',
        timeout: 3000,
      })
      const resolved = out
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line && fs.existsSync(line))
      if (resolved) {
        cachedNodeBin = resolved
        return resolved
      }
    } catch {}

    return 'node'
  }

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

// --- OpenCode CLI plugin ---
// OpenCode scans "plugin" (singular) — not "plugins" — and only picks up
// .js files there, not .mjs. Both confirmed live: a console.error marker
// injected into the pre-existing superpowers.js fired; the same marker in
// our desktop-pet.mjs never did, until renamed to .js.
function openCodeCliPluginPath(): string {
  return path.join(homeDir(), '.config', 'opencode', 'plugin', 'desktop-pet.js')
}

// --- OpenCode Desktop plugin ---
function openCodeDesktopPluginPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'plugin', 'desktop-pet.js')
  }
  return path.join(app.getPath('appData'), 'opencode', 'plugin', 'desktop-pet.js')
}

// --- Codex hooks.json ---
// Codex CLI and Codex Desktop currently share ~/.codex, but Desktop does not
// expose a separate integration API. Installing this file therefore only
// guarantees CLI support; Desktop support depends on whether that build runs
// the same hook pipeline.
function codexHooksPath(): string {
  return path.join(homeDir(), '.codex', 'hooks.json')
}

function codexConfigPath(): string {
  return path.join(homeDir(), '.codex', 'config.toml')
}

// --- Claude Desktop config ---
function claudeDesktopConfigPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  return path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')
}

// --- Claude Code settings.json (shared by CLI & Desktop) ---
function claudeCodeSettingsPath(): string {
  return path.join(homeDir(), '.claude', 'settings.json')
}

// --- Pet window position (persisted across restarts) ---
function windowStatePath(): string {
  return path.join(appDataDir(), 'window-state.json')
}

function readWindowState(): { x: number; y: number } | null {
  const raw = readFile(windowStatePath())
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {}
  return null
}

function writeWindowState(x: number, y: number): void {
  writeFileEnsured(windowStatePath(), JSON.stringify({ x, y }))
}

// --- Hook script path ---
function hookScriptPath(): string {
  return path.join(homeDir(), '.desktop-pet', 'agent-hook.mjs')
}

function hookWrapperPath(): string {
  return path.join(homeDir(), '.desktop-pet', 'agent-hook.cmd')
}

function hookScriptDeployPath(): string {
  return path.join(homeDir(), '.desktop-pet')
}

// --- Bundled integrations/ source (agent-hook.mjs, agent-hook.cmd) ---
// electron-builder copies integrations/ to Resources/integrations via
// extraResources; in dev __dirname is <project>/dist-electron so '..' lands
// back on the project root, matching getPetsJsonPath's dev/prod split.
function integrationsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'integrations')
  }
  return path.join(__dirname, '..', 'integrations')
}

// --- Write helpers ---
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function writeFileEnsured(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content, 'utf-8')
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

function readFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

function appendToFile(filePath: string, line: string): void {
  const existing = readFile(filePath) || ''
  if (existing.includes(line)) return
  const sep = existing.endsWith('\n') || existing.length === 0 ? '' : '\n'
  fs.writeFileSync(filePath, existing + sep + line + '\n', 'utf-8')
}

function removeFromFile(filePath: string, line: string): void {
  const existing = readFile(filePath)
  if (!existing) return
  const lines = existing.split('\n').filter(l => l.trim() !== line.trim())
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')
}

function removeFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

function addJsonKey(filePath: string, key: string, value: unknown): void {
  if (!fs.existsSync(filePath)) return
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  if (content[key] === value) return
  content[key] = value
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8')
}

function removeJsonKey(filePath: string, key: string): void {
  if (!fs.existsSync(filePath)) return
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  if (!(key in content)) return
  delete content[key]
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8')
}

// TOML has no JS parser dependency here, so [features].hooks is patched
// line-by-line rather than via a full parse/stringify round-trip.
function enableCodexHooksFeature(filePath: string): void {
  const existing = readFile(filePath) || ''
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
}

// --- Hook script content (bundled via extraResources) ---
function hookScriptContent(): string {
  return fs.readFileSync(path.join(integrationsDir(), 'agent-hook.mjs'), 'utf-8')
}

function hookWrapperContent(): string {
  return fs
    .readFileSync(path.join(integrationsDir(), 'agent-hook.cmd'), 'utf-8')
    .replace('__NODE_EXECUTABLE__', resolveNodeBin())
}

function installHookScript(): void {
  const dir = hookScriptDeployPath()
  ensureDir(dir)
  writeFileEnsured(hookScriptPath(), hookScriptContent())
  if (IS_WIN) {
    writeFileEnsured(hookWrapperPath(), hookWrapperContent())
  }
  if (!IS_WIN) {
    try { fs.chmodSync(hookScriptPath(), 0o700) } catch {}
  }
}

// --- OpenCode plugin content ---
// OpenCode's real plugin shape: an (async) function that receives a context
// object and returns a hooks object. Tool lifecycle hooks are direct keys;
// session lifecycle notifications arrive through the generic `event` hook.
// There's no direct "user prompt submitted" hook exposed, so the pet won't
// show "thinking" until the first tool call — a known gap, not a bug.
function openCodePluginContent(source: 'opencode-desktop' | 'opencode-cli'): string {
  return `import http from 'http';

const sessionId = 'opencode-' + process.pid + '-' + Date.now();
let currentState = null;
let stateTimer = null;

function sendEvent(state, toolName) {
  const payload = JSON.stringify({
    source: '${source}',
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
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
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
}

function installOpenCode(): void {
  writeFileEnsured(openCodeDesktopPluginPath(), openCodePluginContent('opencode-desktop'))
  writeFileEnsured(openCodeCliPluginPath(), openCodePluginContent('opencode-cli'))
}

function uninstallOpenCode(): void {
  removeFile(openCodeDesktopPluginPath())
  removeFile(openCodeCliPluginPath())
}

// --- Codex hooks ---
const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SessionEnd',
]

function codexHooksJson(): any {
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
    hooks: Object.fromEntries(CODEX_HOOK_EVENTS.map((event) => [event, [handler()]])),
  }
}

function isAgentPetsHook(hook: any): boolean {
  if (hook?.type !== 'command') return false
  const command = typeof hook.command === 'string' ? hook.command : ''
  const args = Array.isArray(hook.args) ? hook.args.join(' ') : ''
  const combined = `${command} ${args}`
  return combined.includes('agent-hook') && combined.includes('desktop-pet')
}

function removeAgentPetsHooks(groups: any): any[] {
  if (!Array.isArray(groups)) return []
  return groups
    .map((group) => {
      if (!Array.isArray(group?.hooks)) return group
      return {
        ...group,
        hooks: group.hooks.filter((hook: any) => !isAgentPetsHook(hook)),
      }
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0)
}

function installCodex(): void {
  installHookScript()

  const hooksFile = codexHooksPath()
  ensureDir(path.dirname(hooksFile))

  const newHooks = codexHooksJson()
  if (fileExists(hooksFile)) {
    try {
      const existing = JSON.parse(readFile(hooksFile) || '{}')
      existing.hooks = existing.hooks || {}
      for (const [event, arr] of Object.entries(newHooks.hooks)) {
        existing.hooks[event] = removeAgentPetsHooks(existing.hooks[event])
        if (!existing.hooks[event] || existing.hooks[event].length === 0) {
          existing.hooks[event] = arr
        } else {
          existing.hooks[event].push((arr as any[])[0])
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

function uninstallCodex(): void {
  removeFile(hookScriptPath())
  removeFile(codexHooksPath())
  const configFile = codexConfigPath()
  if (fileExists(configFile)) {
    removeFromFile(configFile, 'codex_hooks = true')
  }
}

// --- Claude Desktop ---
function installClaude(): void {
  installHookScript()

  const configFile = claudeDesktopConfigPath()
  ensureDir(path.dirname(configFile))

  if (!fileExists(configFile)) {
    writeFileEnsured(configFile, '{}')
  }

  addJsonKey(configFile, 'agent', hookScriptPath())
}

function uninstallClaude(): void {
  removeFile(hookScriptPath())
  const configFile = claudeDesktopConfigPath()
  if (fileExists(configFile)) {
    removeJsonKey(configFile, 'agent')
  }
}

// --- Claude Code (CLI & Desktop share settings.json) ---
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

function claudeCodeHooksJson(): any {
  const hook = hookScriptPath()
  const nodeBin = resolveNodeBin()
  const handler = (event: string) => {
    const entry: any = { hooks: [{ type: 'command', command: nodeBin, args: [hook, 'claude'] }] }
    if (CLAUDE_CODE_TOOL_EVENTS.has(event)) entry.matcher = '*'
    return entry
  }

  return {
    hooks: Object.fromEntries(CLAUDE_CODE_HOOK_EVENTS.map((event) => [event, [handler(event)]])),
  }
}

function installClaudeCode(): void {
  installHookScript()

  const settingsFile = claudeCodeSettingsPath()
  ensureDir(path.dirname(settingsFile))

  const newHooks = claudeCodeHooksJson()
  let existing: any = {}
  if (fileExists(settingsFile)) {
    try {
      existing = JSON.parse(readFile(settingsFile) || '{}')
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
      existing.hooks[event].push((arr as any[])[0])
    }
  }

  writeFileEnsured(settingsFile, JSON.stringify(existing, null, 2))
}

function uninstallClaudeCode(): void {
  const settingsFile = claudeCodeSettingsPath()
  if (!fileExists(settingsFile)) return
  try {
    const existing = JSON.parse(readFile(settingsFile) || '{}')
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
  } catch {
    // malformed settings.json, leave untouched
  }
}

// Repair hooks written by older Windows builds. Those builds used Electron's
// process.execPath as the hook runtime, so their hooks point back to
// Agent Pets.exe and recursively launch the desktop app on every event.
function rewriteInstalledAgentPetsHooks(filePath: string, target: 'codex' | 'claude'): boolean {
  const raw = readFile(filePath)
  if (!raw) return false

  try {
    const config = JSON.parse(raw)
    if (!config.hooks || typeof config.hooks !== 'object') return false

    const hookPath = hookScriptPath()
    const codexCommand = `${hookWrapperPath()} codex`
    const nodeBin = target === 'claude' ? resolveNodeBin() : ''
    let changed = false

    for (const groups of Object.values(config.hooks) as any[]) {
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        if (!Array.isArray(group?.hooks)) continue
        for (const hook of group.hooks) {
          if (!isAgentPetsHook(hook)) continue

          if (target === 'codex') {
            if (hook.command !== codexCommand) {
              hook.command = codexCommand
              changed = true
            }
            if ('args' in hook) {
              delete hook.args
              changed = true
            }
          } else {
            const nextArgs = [hookPath, 'claude']
            if (hook.command !== nodeBin || JSON.stringify(hook.args) !== JSON.stringify(nextArgs)) {
              hook.command = nodeBin
              hook.args = nextArgs
              changed = true
            }
          }
        }
      }
    }

    if (changed) writeFileEnsured(filePath, JSON.stringify(config, null, 2))
    return changed
  } catch {
    return false
  }
}

function repairWindowsInstalledHooks(): void {
  if (!IS_WIN) return

  const codexChanged = rewriteInstalledAgentPetsHooks(codexHooksPath(), 'codex')
  const claudeChanged = rewriteInstalledAgentPetsHooks(claudeCodeSettingsPath(), 'claude')

  if (codexChanged || claudeChanged) installHookScript()
}

export type IntegrationTarget = 'opencode' | 'codex' | 'claude' | 'claudeCode'

function installIntegration(target?: IntegrationTarget): void {
  switch (target) {
    case 'opencode': installOpenCode(); return
    case 'codex': installCodex(); return
    case 'claude': installClaude(); return
    case 'claudeCode': installClaudeCode(); return
    default:
      installOpenCode()
      installCodex()
      installClaude()
      installClaudeCode()
  }
}

function uninstallIntegration(target?: IntegrationTarget): void {
  switch (target) {
    case 'opencode': uninstallOpenCode(); return
    case 'codex': uninstallCodex(); return
    case 'claude': uninstallClaude(); return
    case 'claudeCode': uninstallClaudeCode(); return
    default:
      uninstallOpenCode()
      uninstallCodex()
      uninstallClaude()
      uninstallClaudeCode()
  }
}

export {
  IS_WIN,
  IS_MAC,
  homeDir,
  openCodeCliPluginPath,
  openCodeDesktopPluginPath,
  codexHooksPath,
  codexConfigPath,
  claudeDesktopConfigPath,
  claudeCodeSettingsPath,
  hookScriptPath,
  hookScriptDeployPath,
  ensureDir,
  writeFileEnsured,
  fileExists,
  readFile,
  appendToFile,
  removeFromFile,
  installIntegration,
  uninstallIntegration,
  repairWindowsInstalledHooks,
  readWindowState,
  writeWindowState,
}
