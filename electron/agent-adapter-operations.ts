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
    message: installed ? 'At least one OpenCode plugin is installed.' : 'OpenCode plugin is not installed.',
    checks: [
      check('opencode-cli', cli ? 'pass' : 'warn', cli ? 'OpenCode CLI plugin found.' : 'OpenCode CLI plugin not found.'),
      check('opencode-desktop', desktop ? 'pass' : 'warn', desktop ? 'OpenCode Desktop plugin found.' : 'OpenCode Desktop plugin not found.'),
      check('permission-channel', 'pass', 'Permission responses use the dedicated local broker channel.'),
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
    message: healthy ? 'Codex hooks are configured.' : 'Codex hooks need installation or repair.',
    checks: [
      check('hooks-file', hooks ? 'pass' : 'fail', hooks ? 'Codex hooks.json found.' : 'Codex hooks.json is missing.'),
      check('hooks-enabled', enabled ? 'pass' : 'fail', enabled ? 'Codex hooks are enabled.' : 'Codex hooks are disabled or unconfigured.'),
      check('hook-script', script ? 'pass' : 'fail', script ? 'Shared hook script found.' : 'Shared hook script is missing.'),
      check('hook-command', configured ? 'pass' : 'fail', configured ? 'Agent Pets hook command is configured.' : 'Agent Pets hook command is not configured.'),
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
    message: healthy ? 'Claude Code hooks are configured.' : 'Claude Code hooks need installation or repair.',
    checks: [
      check('settings-file', settings ? 'pass' : 'fail', settings ? 'Claude Code settings found.' : 'Claude Code settings are missing.'),
      check('hook-script', script ? 'pass' : 'fail', script ? 'Shared hook script found.' : 'Shared hook script is missing.'),
      check('hook-command', configured ? 'pass' : 'fail', configured ? 'Agent Pets hook command is configured.' : 'Agent Pets hook command is not configured.'),
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
            message: 'Local /v1/events ingress is available through the authenticated receiver.',
            checks: [
              check('loopback', 'pass', 'Receiver binds to loopback only.'),
              check('token', 'pass', 'Requests require the installation bearer token.'),
              check('permissions', 'pass', 'Generic HTTP is observe-only and cannot respond to permissions.'),
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
