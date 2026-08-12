import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendPermissionAudit } from '../electron/permission-audit.ts'

test('persistent permission audit remains bounded and excludes sensitive fields', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-pets-audit-'))
  const filePath = path.join(directory, 'permission-audit.json')
  try {
    for (let index = 0; index < 505; index += 1) {
      appendPermissionAudit(filePath, {
        requestId: `request-${index}`,
        adapterId: 'opencode-cli',
        agentId: 'opencode-cli',
        sessionId: 'session-1',
        generation: 1,
        receivedAt: index,
        resolvedAt: index + 1,
        status: 'denied',
        decision: 'deny',
        decidedBy: 'bubble',
        terminalReason: 'delivered',
        action: 'secret action',
        description: 'secret description',
        responseHandle: 'secret handle',
      } as never)
    }
    const serialized = readFileSync(filePath, 'utf8')
    const records = JSON.parse(serialized)
    assert.equal(records.length, 500)
    assert.equal(records[0].requestId, 'request-5')
    assert.equal(serialized.includes('secret action'), false)
    assert.equal(serialized.includes('secret description'), false)
    assert.equal(serialized.includes('secret handle'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
