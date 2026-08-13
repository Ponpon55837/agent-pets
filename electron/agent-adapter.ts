import type {
  AdapterContext,
  AdapterDetection,
  AdapterHealth,
  AdapterInstallTarget,
  AdapterNormalizeResult,
  AdapterRuntimeStatus,
  AgentAdapter,
  AgentAdapterId,
  DiagnosticReport,
} from '../src/types/agent-adapter'
import type { AgentCapabilities } from '../src/types/capabilities'
import type { AgentSource } from '../src/types/agent'
import { SOURCE_LABELS } from '../src/types/agent.ts'
import { normalizeAgentStatusEvent } from './event-normalizer.ts'

const ADAPTER_VERSION = '1.0.0'

const OPENCODE_SOURCES: ReadonlyArray<AgentSource> = ['opencode-cli', 'opencode-desktop']
const CODEX_SOURCES: ReadonlyArray<AgentSource> = ['codex', 'codex-desktop']
const CLAUDE_SOURCES: ReadonlyArray<AgentSource> = ['claude', 'claude-desktop']

function freezeCapabilities(value: AgentCapabilities): Readonly<AgentCapabilities> {
  return Object.freeze({
    ...value,
    permissionModes: Object.freeze([...value.permissionModes]),
  })
}

const OPENCODE_CAPABILITIES = freezeCapabilities({
  lifecycle: true,
  sessions: true,
  projects: true,
  toolActivity: true,
  tokenUsage: 'estimated',
  quota: 'none',
  waitingInput: true,
  permissions: 'respond',
  permissionModes: ['allow_once', 'deny'],
  orderedEvents: false,
  healthCheck: true,
})

const CODEX_CAPABILITIES = freezeCapabilities({
  lifecycle: true,
  sessions: true,
  projects: true,
  toolActivity: true,
  tokenUsage: 'estimated',
  quota: 'provider',
  waitingInput: true,
  permissions: 'observe',
  permissionModes: [],
  orderedEvents: false,
  healthCheck: true,
})

const CLAUDE_CAPABILITIES = freezeCapabilities({
  lifecycle: true,
  sessions: true,
  projects: true,
  toolActivity: true,
  tokenUsage: 'estimated',
  quota: 'provider',
  waitingInput: true,
  permissions: 'observe',
  permissionModes: [],
  orderedEvents: false,
  healthCheck: true,
})

const GENERIC_HTTP_CAPABILITIES = freezeCapabilities({
  lifecycle: true,
  sessions: true,
  projects: true,
  toolActivity: true,
  tokenUsage: 'none',
  quota: 'none',
  waitingInput: true,
  permissions: 'none',
  permissionModes: [],
  orderedEvents: false,
  healthCheck: false,
})

export interface AdapterInspection {
  installed: boolean
  health: AdapterHealth
  message: string
  checks: DiagnosticReport['checks']
}

interface AdapterDefinition {
  id: AgentAdapterId
  displayName: string
  sources: ReadonlyArray<AgentSource>
  sourceLabels: ReadonlyArray<string>
  capabilities: Readonly<AgentCapabilities>
  installTarget?: AdapterInstallTarget
  installable: boolean
  testSource?: AgentSource
  defaultInspection?: AdapterInspection
}

export interface AgentAdapterOperations {
  inspect(id: AgentAdapterId): AdapterInspection
  install(target: AdapterInstallTarget): void
  uninstall(target: AdapterInstallTarget): void
}

function sourceLabelsFor(sources: ReadonlyArray<AgentSource>): ReadonlyArray<string> {
  return Object.freeze(sources.map(source => SOURCE_LABELS[source]))
}

function check(id: string, status: 'pass' | 'warn' | 'fail', message: string) {
  return { id, status, message }
}

function inspectGenericHttp(): AdapterInspection {
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

const DEFINITIONS: ReadonlyArray<AdapterDefinition> = Object.freeze([
  {
    id: 'opencode',
    displayName: 'OpenCode',
    sources: OPENCODE_SOURCES,
    sourceLabels: sourceLabelsFor(OPENCODE_SOURCES),
    capabilities: OPENCODE_CAPABILITIES,
    installTarget: 'opencode',
    installable: true,
    testSource: 'opencode-cli',
  },
  {
    id: 'codex',
    displayName: 'Codex',
    sources: CODEX_SOURCES,
    sourceLabels: sourceLabelsFor(CODEX_SOURCES),
    capabilities: CODEX_CAPABILITIES,
    installTarget: 'codex',
    installable: true,
    testSource: 'codex',
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    sources: CLAUDE_SOURCES,
    sourceLabels: sourceLabelsFor(CLAUDE_SOURCES),
    capabilities: CLAUDE_CAPABILITIES,
    installTarget: 'claudeCode',
    installable: true,
    testSource: 'claude',
  },
  {
    id: 'generic-http',
    displayName: 'Generic HTTP',
    sources: [],
    sourceLabels: Object.freeze(['/v1/events']),
    capabilities: GENERIC_HTTP_CAPABILITIES,
    installable: false,
    defaultInspection: inspectGenericHttp(),
  },
])

function context(): AdapterContext {
  return { now: () => Date.now() }
}

function createAdapter(definition: AdapterDefinition, operations: AgentAdapterOperations): AgentAdapter {
  return {
    id: definition.id,
    displayName: definition.displayName,
    adapterVersion: ADAPTER_VERSION,
    sources: definition.sources,
    capabilities: definition.capabilities,
    detect: async () => {
      const inspection = definition.defaultInspection ?? operations.inspect(definition.id)
      return {
        installed: inspection.installed,
        health: inspection.health,
        message: inspection.message,
        capabilities: definition.capabilities,
        sources: definition.sources,
        sourceLabels: definition.sourceLabels,
        ...(definition.installTarget ? { installTarget: definition.installTarget } : {}),
        installable: definition.installable,
        ...(definition.testSource ? { testSource: definition.testSource } : {}),
      }
    },
    install: async () => {
      if (definition.installTarget) operations.install(definition.installTarget)
      return (await createAdapter(definition, operations).detect(context()))
    },
    uninstall: async () => {
      if (definition.installTarget) operations.uninstall(definition.installTarget)
      return (await createAdapter(definition, operations).detect(context()))
    },
    diagnose: async ctx => {
      const inspection = definition.defaultInspection ?? operations.inspect(definition.id)
      return {
        adapterId: definition.id,
        health: inspection.health,
        checkedAt: ctx.now(),
        checks: inspection.checks,
      }
    },
    normalize: async (input, _ctx, receivedAt) => {
      const normalized = normalizeAgentStatusEvent(input, receivedAt)
      if (!normalized.ok) return normalized
      if (definition.id !== 'generic-http' && !definition.sources.includes(normalized.event.source)) {
        return { ok: false, error: 'source_not_supported' }
      }
      return {
        ok: true,
        event: { ...normalized.event, adapterId: definition.id },
      }
    },
  }
}

export interface AgentAdapterRegistry {
  readonly adapters: ReadonlyArray<AgentAdapter>
  listStatuses(): Promise<ReadonlyArray<AdapterRuntimeStatus>>
  diagnose(id: AgentAdapterId): Promise<DiagnosticReport | null>
  install(id: AgentAdapterId): Promise<AdapterDetection | null>
  uninstall(id: AgentAdapterId): Promise<AdapterDetection | null>
  normalize(input: unknown, receivedAt?: number): Promise<AdapterNormalizeResult>
}

export function isAgentAdapterId(value: unknown): value is AgentAdapterId {
  return value === 'opencode'
    || value === 'codex'
    || value === 'claude-code'
    || value === 'generic-http'
}

const DEFAULT_OPERATIONS: AgentAdapterOperations = {
  inspect: id => ({
    installed: id === 'generic-http',
    health: id === 'generic-http' ? 'ready' : 'needs_install',
    message: id === 'generic-http' ? '本機 /v1/events ingress 可使用。' : 'Adapter 尚未安裝。',
    checks: id === 'generic-http'
      ? inspectGenericHttp().checks
      : [check('runtime', 'warn', '此執行環境未提供 Setup operations。')],
  }),
  install: () => {},
  uninstall: () => {},
}

export function createAgentAdapterRegistry(operations: AgentAdapterOperations = DEFAULT_OPERATIONS): AgentAdapterRegistry {
  const adapters = Object.freeze(DEFINITIONS.map(definition => createAdapter(definition, operations)))
  const byId = new Map(adapters.map(adapter => [adapter.id, adapter]))
  const generic = byId.get('generic-http')!

  return {
    adapters,
    async listStatuses() {
      const statuses = await Promise.all(adapters.map(async adapter => {
        const detection = await adapter.detect(context())
        return {
          id: adapter.id,
          displayName: adapter.displayName,
          adapterVersion: adapter.adapterVersion,
          ...detection,
        }
      }))
      return statuses
    },
    diagnose(id) {
      return byId.get(id)?.diagnose(context()) ?? Promise.resolve(null)
    },
    install(id) {
      return byId.get(id)?.install(context()) ?? Promise.resolve(null)
    },
    uninstall(id) {
      return byId.get(id)?.uninstall(context()) ?? Promise.resolve(null)
    },
    async normalize(input, receivedAt = Date.now()) {
      const raw = input && typeof input === 'object' && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {}
      const requestedId = raw.adapterId
      if (requestedId !== undefined) {
        if (!isAgentAdapterId(requestedId)) return { ok: false, error: 'unknown_adapter' }
        // `/v1/events` is a generic local ingress. A caller may explicitly
        // opt into the observe-only adapter, but cannot self-assert a
        // built-in adapter with stronger capabilities.
        if (requestedId !== 'generic-http') return { ok: false, error: 'adapter_claim_not_allowed' }
        return byId.get(requestedId)!.normalize(input, context(), receivedAt)
      }
      const source = typeof raw.source === 'string' ? raw.source : undefined
      const sourceAdapter = adapters.find(adapter => adapter.sources.includes(source as AgentSource))
      return (sourceAdapter ?? generic).normalize(input, context(), receivedAt)
    },
  }
}
