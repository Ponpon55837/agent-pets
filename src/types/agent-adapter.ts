import type { AgentCapabilities } from './capabilities'
import type { AgentSource, AgentStatusEvent } from './agent'

export type AgentAdapterId = 'opencode' | 'codex' | 'claude-code' | 'generic-http'

export type AdapterInstallTarget = 'opencode' | 'codex' | 'claudeCode'

export type AdapterHealth = 'ready' | 'needs_install' | 'needs_approval' | 'degraded' | 'error'

export type DiagnosticCheckStatus = 'pass' | 'warn' | 'fail'

export interface AdapterDiagnosticCheck {
  id: string
  status: DiagnosticCheckStatus
  message: string
}

export interface DiagnosticReport {
  adapterId: AgentAdapterId
  health: AdapterHealth
  checkedAt: number
  checks: ReadonlyArray<AdapterDiagnosticCheck>
}

export interface AdapterDetection {
  installed: boolean
  health: AdapterHealth
  version?: string
  message?: string
  capabilities: Readonly<AgentCapabilities>
  sources: ReadonlyArray<AgentSource>
  sourceLabels: ReadonlyArray<string>
  installTarget?: AdapterInstallTarget
  installable: boolean
  testSource?: AgentSource
}

export interface AdapterRuntimeStatus extends AdapterDetection {
  id: AgentAdapterId
  displayName: string
  adapterVersion: string
}

export interface AdapterContext {
  readonly now: () => number
}

export type AdapterNormalizationError =
  | 'source_not_supported'
  | 'unknown_adapter'

export type AdapterNormalizeResult =
  | { ok: true; event: AgentStatusEvent }
  | { ok: false; error: string }

/**
 * Main-process contract shared by built-in and fixture-only adapters.
 * Implementations own installation, diagnostics and raw-event normalization;
 * Event Core and product projections consume only the returned AgentStatusEvent.
 */
export interface AgentAdapter {
  readonly id: AgentAdapterId
  readonly displayName: string
  readonly adapterVersion: string
  readonly sources: ReadonlyArray<AgentSource>
  readonly capabilities: Readonly<AgentCapabilities>

  detect(ctx: AdapterContext): Promise<AdapterDetection>
  install(ctx: AdapterContext): Promise<AdapterDetection>
  uninstall(ctx: AdapterContext): Promise<AdapterDetection>
  diagnose(ctx: AdapterContext): Promise<DiagnosticReport>
  normalize(input: unknown, ctx: AdapterContext, receivedAt?: number): Promise<AdapterNormalizeResult>
}
