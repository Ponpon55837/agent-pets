import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EDGE_DWELL_MS,
  EDGE_HANDLE_LENGTH_PX,
  EDGE_PEEK_PX,
  clampWindowBounds,
  edgeWindowBounds,
  miniWindowBounds,
  nearestEdge,
} from '../electron/pet-window-mode.ts'

const workArea = { x: -1920, y: 0, width: 1920, height: 1080 }

test('clamps bounds to a display work area including negative monitor origins', () => {
  assert.deepEqual(
    clampWindowBounds({ x: -2100, y: -40, width: 240, height: 240 }, workArea),
    { x: -1920, y: 0, width: 240, height: 240 },
  )
})

test('mini mode preserves the normal pet bottom anchor', () => {
  const normal = { x: -900, y: 700, width: 260, height: 350 }
  const mini = miniWindowBounds(normal, workArea)
  assert.equal(mini.width, 96)
  assert.equal(mini.height, 96)
  assert.equal(mini.y + mini.height, normal.y + normal.height)
})

test('nearest edge requires a bounded dwell target', () => {
  assert.equal(nearestEdge({ x: -1920, y: 400, width: 260, height: 300 }, workArea), 'left')
  assert.equal(nearestEdge({ x: -1700, y: 400, width: 260, height: 300 }, workArea), null)
  assert.equal(EDGE_DWELL_MS, 650)
})

test('edge mode keeps a visible peek and preserves the normal size', () => {
  const normal = { x: -900, y: 700, width: 260, height: 350 }
  const edge = edgeWindowBounds(normal, workArea, 'left')
  assert.equal(edge.width, EDGE_PEEK_PX)
  assert.equal(edge.height, EDGE_HANDLE_LENGTH_PX)
  assert.equal(edge.x, workArea.x)
})
