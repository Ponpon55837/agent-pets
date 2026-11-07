import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ICON_PATHS } from '../src/components/ui/icons.ts'

test('icon set contains the glyph replacements and every path is well-formed', () => {
  for (const name of ['close', 'sparkle', 'wrench', 'alert', 'plugin', 'external-link', 'check', 'info', 'search']) {
    assert.ok(ICON_PATHS[name], `missing icon ${name}`)
  }
  for (const [name, d] of Object.entries(ICON_PATHS)) {
    assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/, `${name}: invalid path data`)
    assert.match(d, /^[Mm]/, `${name}: must start with a moveto`)
  }
})

test('ui primitives contain no text-glyph icons', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'components', 'ui')
  const glyph = /[×←-➿⬀-⯿]|\p{Extended_Pictographic}/u
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.vue') && f !== 'Icon.vue')) {
    const tpl = readFileSync(join(dir, name), 'utf8').split('<style')[0].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    assert.doesNotMatch(tpl, glyph, `${name} uses a glyph as an icon`)
  }
})
