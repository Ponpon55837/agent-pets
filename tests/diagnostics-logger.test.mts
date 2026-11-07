import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../electron/diagnostics/logger.ts'
import { redactText, redactValue } from '../electron/diagnostics/redact.ts'
import { buildDiagnosticsReport, clearDiagnosticsSections, registerDiagnosticsSection } from '../electron/diagnostics/report.ts'
import { acquireRunMarker } from '../electron/diagnostics/session-marker.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'ap-log-'))

test('redacts tokens, secrets, hashes and home paths', () => {
  const text = redactText('POST /v1 x-agent-pets-token: abcdef1234567890abcdef12 Authorization=Bearer abc.def.ghi1234 at /Users/alice/proj/file.ts C:\\Users\\Bob\\x sk-abcdefghijklmnopqrstuvwxyz', { home: '/Users/alice' })
  assert.doesNotMatch(text, /abcdef1234567890|alice|Bob|abc\.def|sk-abcdef/)
  assert.match(text, /~\/proj\/file\.ts/)
})

test('redactValue drops content-bearing keys', () => {
  const out = redactValue({ prompt: 'secret plan', toolName: 'Bash', nested: { token: 'x', ok: 1 } }) as Record<string, any>
  assert.equal(out.prompt, '[redacted]')
  assert.equal(out.toolName, 'Bash')
  assert.equal(out.nested.token, '[redacted]')
  assert.equal(out.nested.ok, 1)
})

test('logger writes redacted lines and respects the level', () => {
  const d = dir()
  const logger = createLogger({ directory: d, redact: { home: '/Users/alice' } })
  logger.log('debug', 'main', 'hidden')
  logger.log('error', 'main', 'failed in /Users/alice/x', { token: 'zzz' })
  const lines = logger.readRecent()
  assert.equal(lines.length, 1)
  assert.match(lines[0], /ERROR \[main\] failed in ~\/x/)
  assert.doesNotMatch(lines[0], /alice|zzz/)
})

test('logger rotates by size and keeps a bounded number of files', () => {
  const d = dir()
  const logger = createLogger({ directory: d, maxBytes: 400, maxFiles: 3 })
  for (let i = 0; i < 60; i += 1) logger.log('error', 'main', `line number ${i} padding padding padding`)
  logger.flush()
  const files = readdirSync(d).filter(f => f.startsWith('main.log')).sort()
  assert.deepEqual(files, ['main.log', 'main.log.1', 'main.log.2'])
  assert.match(logger.readRecent(1)[0], /line number 59/)
})

test('diagnostics report aggregates sections, survives a failing one, and redacts the whole document', () => {
  clearDiagnosticsSections()
  registerDiagnosticsSection('good', () => ({ count: 2, path: '/Users/zed/a' }))
  registerDiagnosticsSection('bad', () => { throw new Error('nope') })
  const report = JSON.parse(buildDiagnosticsReport({
    app: { version: '1', electron: '2', chrome: '3', node: '4', platform: 'x', arch: 'y', packaged: false, locale: 'zh-TW' },
    recentLogLines: ['a'], generatedAt: 0,
  }))
  assert.equal(report.good.count, 2)
  assert.equal(report.good.path, '~/a')
  assert.equal(report.bad.error, 'nope')
  assert.deepEqual(report.recentLog, ['a'])
  clearDiagnosticsSections()
})

test('run marker flags an unclean previous exit', () => {
  const d = dir()
  const first = acquireRunMarker(d)
  assert.equal(first.previousRunUnclean, false)
  const second = acquireRunMarker(d)
  assert.equal(second.previousRunUnclean, true)
  second.clear()
  assert.equal(existsSync(join(d, 'running.lock')), false)
  assert.equal(acquireRunMarker(d).previousRunUnclean, false)
  void readFileSync; void writeFileSync
})
