import test from 'node:test'
import assert from 'node:assert/strict'
import { PAIRS, contrast, evaluate, parseTokens, resolveHex } from '../scripts/check-contrast.mjs'

test('contrast maths matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21)
  assert.ok(Math.abs(contrast('#858b9b', '#12121a') - 5.47) < 0.02)
})

test('every documented token pair resolves and meets its minimum ratio', () => {
  const map = parseTokens()
  for (const r of evaluate(map)) {
    assert.ok(r.ratio !== null, `${r.fg} on ${r.bg} could not be resolved to hex`)
    assert.ok(r.ok, `${r.fg} on ${r.bg} is ${r.ratio?.toFixed(2)}, needs ${r.min} (${r.note})`)
  }
  assert.ok(PAIRS.length > 10)
})

test('alias tokens resolve through var()', () => {
  const map = parseTokens()
  assert.equal(resolveHex(map, '--color-text'), resolveHex(map, '--organic-text'))
})
