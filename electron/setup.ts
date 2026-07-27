import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

function homeDir(): string {
  return os.homedir()
}

function appDataDir(): string {
  return app.getPath('userData')
}

// --- OpenCode CLI plugin ---
function openCodeCliPluginPath(): string {
  return path.join(homeDir(), '.config', 'opencode', 'plugins', 'desktop-pet.mjs')
}

// --- OpenCode Desktop plugin ---
function openCodeDesktopPluginPath(): string {
  if (IS_MAC) {
    return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'plugins', 'desktop-pet.mjs')
  }
  return path.join(app.getPath('appData'), 'opencode', 'plugins', 'desktop-pet.mjs')
}

// --- Codex hooks.json ---
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

// --- Hook script path ---
function hookScriptPath(): string {
  return path.join(homeDir(), '.desktop-pet', 'agent-hook.mjs')
}

function hookScriptDeployPath(): string {
  return path.join(homeDir(), '.desktop-pet')
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

export {
  IS_WIN,
  IS_MAC,
  homeDir,
  openCodeCliPluginPath,
  openCodeDesktopPluginPath,
  codexHooksPath,
  codexConfigPath,
  claudeDesktopConfigPath,
  hookScriptPath,
  hookScriptDeployPath,
  ensureDir,
  writeFileEnsured,
  fileExists,
  readFile,
  appendToFile,
  removeFromFile,
}
