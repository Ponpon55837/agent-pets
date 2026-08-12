import assert from 'node:assert/strict'
import type { AgentAdapter } from '../../src/types/agent-adapter.ts'
import type { AgentSource } from '../../src/types/agent.ts'

export async function assertAgentAdapterContract(
  adapter: AgentAdapter,
  source: AgentSource,
  expectedAdapterId = adapter.id,
): Promise<void> {
  const context = { now: () => 1_700_000_000_000 }
  const detection = await adapter.detect(context)
  assert.deepEqual(detection.sources, adapter.sources)
  assert.deepEqual(detection.capabilities, adapter.capabilities)

  const report = await adapter.diagnose(context)
  assert.equal(report.adapterId, adapter.id)
  assert.ok(report.checks.length > 0)

  const normalized = await adapter.normalize({
    source,
    sessionId: `fixture-${adapter.id}`,
    state: 'thinking',
    timestamp: context.now(),
  }, context, context.now())
  assert.equal(normalized.ok, true)
  if (normalized.ok) {
    assert.equal(normalized.event.adapterId, expectedAdapterId)
    assert.equal(normalized.event.source, source)
    assert.equal(normalized.event.timestamp, context.now())
  }
}
