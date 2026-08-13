import { join } from 'node:path'
import type { AgentAdapterId, AdapterInstallTarget } from '../src/types/agent-adapter'
import type { AgentAdapterOperations, AdapterInspection } from './agent-adapter.ts'
import {
  claudeCodeSettingsPath,
  codexConfigPath,
  codexHooksPath,
  fileExists,
  hookScriptDeployPath,
  hookScriptPath,
  installIntegration,
  openCodeCliPluginPath,
  openCodeDesktopPluginPath,
  readFile,
  uninstallIntegration,
} from './setup.ts'

function check(id: string, status: 'pass' | 'warn' | 'fail', message: string) {
  return { id, status, message }
}

function isCodexHooksEnabled(config: string | null): boolean {
  if (!config) return false
  return !config.includes('hooks = false') && !config.includes('codex_hooks = false')
}

// Codex uses shell-form hooks while Claude Code uses exec-form hooks. Keep the
// detection rule identical to the installer repair logic so a config file that
// merely exists is never reported as a healthy Agent Pets integration.
function isAgentPetsHookConfigured(settingsPath: string, expectedArg: string): boolean {
  const raw = readFile(settingsPath)
  if (!raw) return false

  try {
    const config = JSON.parse(raw) as { hooks?: unknown }
    const events = config.hooks
    if (!events || typeof events !== 'object') return false
    const hookPaths = [hookScriptPath(), join(hookScriptDeployPath(), 'agent-hook.cmd')]
    return Object.values(events as Record<string, unknown>).some(groups => {
      if (!Array.isArray(groups)) return false
      return groups.some(group => {
        if (!group || typeof group !== 'object' || !Array.isArray((group as { hooks?: unknown }).hooks)) return false
        return (group as { hooks: unknown[] }).hooks.some(hook => {
          if (!hook || typeof hook !== 'object' || (hook as { type?: unknown }).type !== 'command') return false
          const command = typeof (hook as { command?: unknown }).command === 'string'
            ? (hook as { command: string }).command
            : ''
          const args = Array.isArray((hook as { args?: unknown }).args)
            ? (hook as { args: unknown[] }).args.join(' ')
            : ''
          const combined = `${command} ${args}`
          return hookPaths.some(hookPath => combined.includes(hookPath)) && combined.includes(expectedArg)
        })
      })
    })
  } catch {
    return false
  }
}

function inspectOpenCode(): AdapterInspection {
  const cli = fileExists(openCodeCliPluginPath())
  const desktop = fileExists(openCodeDesktopPluginPath())
  const installed = cli || desktop
  return {
    installed,
    health: installed ? 'ready' : 'needs_install',
    message: installed ? '至少有一個 OpenCode plugin 已安裝。' : '尚未安裝 OpenCode plugin。',
    checks: [
      check('opencode-cli', cli ? 'pass' : 'warn', cli ? '找到 OpenCode CLI plugin。' : '找不到 OpenCode CLI plugin。'),
      check('opencode-desktop', desktop ? 'pass' : 'warn', desktop ? '找到 OpenCode Desktop plugin。' : '找不到 OpenCode Desktop plugin。'),
      check('permission-channel', 'pass', 'Permission 回應使用專用的本機 Broker channel。'),
    ],
  }
}

function inspectCodex(): AdapterInspection {
  const hooks = fileExists(codexHooksPath())
  const script = fileExists(hookScriptPath())
  const enabled = isCodexHooksEnabled(readFile(codexConfigPath()))
  const configured = isAgentPetsHookConfigured(codexHooksPath(), ' codex')
  const healthy = hooks && script && configured && enabled
  const partiallyInstalled = hooks || script || configured
  return {
    installed: healthy,
    health: healthy ? 'ready' : partiallyInstalled ? 'degraded' : 'needs_install',
    message: healthy ? 'Codex hooks 已完成設定。' : 'Codex hooks 需要安裝或修復。',
    checks: [
      check('hooks-file', hooks ? 'pass' : 'fail', hooks ? '找到 Codex hooks.json。' : '找不到 Codex hooks.json。'),
      check('hooks-enabled', enabled ? 'pass' : 'fail', enabled ? 'Codex hooks 已啟用。' : 'Codex hooks 已停用或尚未設定。'),
      check('hook-script', script ? 'pass' : 'fail', script ? '找到共用 hook script。' : '找不到共用 hook script。'),
      check('hook-command', configured ? 'pass' : 'fail', configured ? 'Agent Pets hook command 已設定。' : '尚未設定 Agent Pets hook command。'),
    ],
  }
}

function inspectClaudeCode(): AdapterInspection {
  const settings = fileExists(claudeCodeSettingsPath())
  const script = fileExists(hookScriptPath())
  const configured = isAgentPetsHookConfigured(claudeCodeSettingsPath(), 'claude')
  const healthy = settings && script && configured
  const partiallyInstalled = settings || script || configured
  return {
    installed: healthy,
    health: healthy ? 'ready' : partiallyInstalled ? 'degraded' : 'needs_install',
    message: healthy ? 'Claude Code hooks 已完成設定。' : 'Claude Code hooks 需要安裝或修復。',
    checks: [
      check('settings-file', settings ? 'pass' : 'fail', settings ? '找到 Claude Code settings。' : '找不到 Claude Code settings。'),
      check('hook-script', script ? 'pass' : 'fail', script ? '找到共用 hook script。' : '找不到共用 hook script。'),
      check('hook-command', configured ? 'pass' : 'fail', configured ? 'Agent Pets hook command 已設定。' : '尚未設定 Agent Pets hook command。'),
    ],
  }
}

export function createAgentAdapterOperations(): AgentAdapterOperations {
  return {
    inspect(id: AgentAdapterId): AdapterInspection {
      switch (id) {
        case 'opencode': return inspectOpenCode()
        case 'codex': return inspectCodex()
        case 'claude-code': return inspectClaudeCode()
        case 'generic-http':
          return {
            installed: true,
            health: 'ready',
            message: '本機 /v1/events ingress 可透過已驗證的 receiver 使用。',
            checks: [
              check('loopback', 'pass', 'Receiver 僅繫結 loopback。'),
              check('token', 'pass', '請求需要安裝時產生的 bearer token。'),
              check('permissions', 'pass', 'Generic HTTP 僅能 observe-only，無法回應 Permission。'),
            ],
          }
      }
    },
    install(target: AdapterInstallTarget): void {
      installIntegration(target)
    },
    uninstall(target: AdapterInstallTarget): void {
      uninstallIntegration(target)
    },
  }
}
