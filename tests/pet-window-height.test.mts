import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PET_BASE_H,
  QUOTA_TOOLTIP_HEADROOM_H,
  STATUS_LINE_EXTRA_H,
  STATUS_LINE_PROJECT_H,
  petWindowHeight,
} from '../src/utils/pet-window-height.ts'

const quiet = { count: 1, project: 'web' }
const busy = { count: 3, project: 'agent-pets' }

test('single pet: each line with a project row adds that row, unscaled', () => {
  assert.equal(petWindowHeight([], false, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(petWindowHeight([quiet], false, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(petWindowHeight([busy], false, 1), PET_BASE_H + STATUS_LINE_PROJECT_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(
    petWindowHeight([busy, quiet, busy], false, 1),
    PET_BASE_H + 2 * STATUS_LINE_EXTRA_H + 2 * STATUS_LINE_PROJECT_H + QUOTA_TOOLTIP_HEADROOM_H,
  )
  // The pill keeps its size whatever the pet size, so only the sprite part scales.
  assert.equal(petWindowHeight([busy], false, 0.5), Math.round(PET_BASE_H * 0.5) + STATUS_LINE_PROJECT_H + QUOTA_TOOLTIP_HEADROOM_H)
})

test('a family with several sessions but no project gets no project row', () => {
  assert.equal(petWindowHeight([{ count: 4 }], false, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
})

test('multi pet: pills share one row, so a project row is added once', () => {
  assert.equal(petWindowHeight([quiet, quiet], true, 1), PET_BASE_H + QUOTA_TOOLTIP_HEADROOM_H)
  assert.equal(petWindowHeight([busy, busy, quiet], true, 1), PET_BASE_H + STATUS_LINE_PROJECT_H + QUOTA_TOOLTIP_HEADROOM_H)
})

test('the project row budget covers the rendered row', () => {
  // .line-project is font-xs (11px) at line-height 1.2.
  assert.ok(STATUS_LINE_PROJECT_H >= Math.ceil(11 * 1.2))
})
