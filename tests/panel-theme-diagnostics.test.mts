import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { panelThemeModeCheckInput, panelThemeModeIssues, panelThemeModeIssuesReading, type PanelThemeModeCheckInput } from '../electron/plugin-panel-themes.ts'
import { userPanelThemeContribution } from '../electron/panel-theme-user.ts'
import { validateUserPanelTheme } from '../electron/panel-theme-diagnostics.ts'
import { canonicalJson, CANONICAL_JSON_MAX_DEPTH, ContentHashCache } from '../electron/main/panel-theme-cache.ts'
import { PanelThemeRuntime } from '../electron/main/panel-theme-runtime.ts'
import { UserPanelThemeStore, UserPanelThemeStoreError } from '../electron/panel-theme-user-store.ts'
import { USER_PANEL_THEME_COLOR_KEYS, USER_PANEL_THEME_MAX_BYTES, type UserPanelThemeDefinition } from '../src/types/panel-theme-user.ts'
import type { PanelThemeMode } from '../src/types/panel-theme.ts'
import { builtinDefinition } from './support/panel-theme-fixtures.mts'

// M4／L2：建議值搜尋只重跑讀到被換的鍵的檢查，並且在明度上二分搜尋；
// 不受信任的深層巢狀在雜湊之前就被結構解析擋下。

function lcg(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function inputsFor(definition: UserPanelThemeDefinition): Array<[PanelThemeMode, PanelThemeModeCheckInput]> {
  const contribution = userPanelThemeContribution('draft', 'Draft', definition)
  const modes = contribution.modes as Record<PanelThemeMode, unknown>
  return (['light', 'dark'] as const).map(mode => [mode, panelThemeModeCheckInput(modes[mode], mode)])
}

function midGrey(): UserPanelThemeDefinition {
  const definition = builtinDefinition()
  for (const mode of ['light', 'dark'] as const) {
    for (const key of USER_PANEL_THEME_COLOR_KEYS) definition.modes[mode].colors[key] = 'rgb(128 128 128 / 1)'
  }
  return definition
}

test('changing one key changes only the checks that read it (the invariant the suggestion search relies on)', () => {
  const random = lcg(42)
  const colour = () => ({ r: Math.floor(random() * 256), g: Math.floor(random() * 256), b: Math.floor(random() * 256), a: 1 })
  const ids = (issues: Iterable<unknown>) => [...issues].map(issue => JSON.stringify(issue))
  const without = (all: string[], removed: string[]) => {
    const pending = new Map<string, number>()
    for (const id of removed) pending.set(id, (pending.get(id) ?? 0) + 1)
    return all.filter(id => {
      const count = pending.get(id) ?? 0
      if (count === 0) return true
      pending.set(id, count - 1)
      return false
    })
  }
  for (let round = 0; round < 40; round += 1) {
    const definition = round % 2 === 0 ? builtinDefinition() : midGrey()
    definition.modes.dark.petStatus = { background: 'rgb(20 20 20 / 0.95)', text: 'rgb(240 240 240 / 1)', textMuted: 'rgb(200 200 200 / 1)', border: 'rgb(255 255 255 / 0.2)', quotaFill: 'rgb(120 200 160 / 1)', quotaTrack: 'rgb(255 255 255 / 0.2)', quotaWarn: 'rgb(230 180 80 / 1)' }
    for (const [mode, input] of inputsFor(definition)) {
      const reads = [...USER_PANEL_THEME_COLOR_KEYS.map(key => `colors.${key}`), ...(mode === 'dark' ? ['petStatus.text', 'petStatus.background', 'petStatus.quotaTrack'] : [])]
      const read = reads[Math.floor(random() * reads.length)]!
      const [group, key] = read.split('.') as ['colors' | 'petStatus', string]
      const replaced: PanelThemeModeCheckInput = group === 'colors'
        ? { ...input, colors: { ...input.colors, [key]: colour() } }
        : { ...input, petStatus: { ...input.petStatus!, [key]: colour() } }
      const before = ids(panelThemeModeIssues(input))
      const after = ids(panelThemeModeIssues(replaced))
      // 每個問題的 path 都在讀到它的檢查裡。
      for (const issue of panelThemeModeIssues(replaced)) {
        assert.ok(ids(panelThemeModeIssuesReading(replaced, issue.path)).includes(JSON.stringify(issue)), `${mode} ${issue.path}`)
      }
      // 沒讀到這個鍵的檢查，結果與替換前完全相同。
      assert.deepEqual(
        without(after, ids(panelThemeModeIssuesReading(replaced, read))),
        without(before, ids(panelThemeModeIssuesReading(input, read))),
        `${mode} ${read}`,
      )
    }
  }
})

test('every suggestion fixes its key without adding a new problem', () => {
  const definition = midGrey()
  const validation = validateUserPanelTheme(definition)
  const suggested = validation.issues.filter(issue => typeof issue.suggested === 'string' && issue.path.startsWith('colors.'))
  assert.ok(suggested.length > 20)
  // 以完整的問題清單比較（validateUserPanelTheme 的回傳有數量上限）。
  const idOf = (issue: { path: string; kind: string; foreground?: string; background?: string }) => `${issue.path}\u0000${issue.kind}\u0000${issue.foreground ?? ''}\u0000${issue.background ?? ''}`
  const all = new Map(inputsFor(definition).map(([mode, input]) => [mode, new Set([...panelThemeModeIssues(input)].map(idOf))]))
  for (const issue of suggested) {
    const next = structuredClone(definition)
    next.modes[issue.mode].colors[issue.path.slice('colors.'.length) as 'text'] = issue.suggested as string
    const input = inputsFor(next).find(([mode]) => mode === issue.mode)![1]
    for (const after of panelThemeModeIssues(input)) {
      assert.notEqual(after.path, issue.path, `${issue.mode} ${issue.path} is fixed`)
      assert.ok(all.get(issue.mode)!.has(idOf(after)), `${issue.mode} ${issue.path} adds no new problem (${after.path})`)
    }
  }
})

test('the worst-case draft (every key mid-grey) validates within a timing ceiling', () => {
  const definition = midGrey()
  validateUserPanelTheme(definition)
  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now()
    validateUserPanelTheme(definition)
    best = Math.min(best, performance.now() - started)
  }
  // 逐格重跑完整驗證的舊做法在同一台機器上最快約 43 ms、中位數約 48 ms；現在約 5 ms。
  assert.ok(best < 30, `worst-case validation took ${best.toFixed(1)} ms`)
})

test('a deeply nested payload is rejected by the structural parse before anything is hashed', () => {
  let deep: unknown = 1
  for (let level = 0; level < 8000; level += 1) deep = [deep]
  const payload = { typography: deep, shape: {}, modes: {} }
  assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') <= USER_PANEL_THEME_MAX_BYTES)
  assert.throws(() => canonicalJson(deep), RangeError)
  assert.doesNotThrow(() => canonicalJson(JSON.parse(JSON.stringify(builtinDefinition()))))
  let nested: unknown = 0
  for (let level = 0; level < CANONICAL_JSON_MAX_DEPTH; level += 1) nested = [nested]
  assert.doesNotThrow(() => canonicalJson(nested))

  const userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-diagnostics-')))
  try {
    const runtime = new PanelThemeRuntime({
      userDataDirectory: userData,
      pluginRoot: () => userData,
      readRegularFileWithin: async () => null,
      send: () => {},
      sendPetStatus: () => {},
      rendererOrigin: () => null,
      sendPluginTheme: () => {},
      schedulePluginTheme: callback => callback(),
    })
    const validation = runtime.validate(payload)
    assert.equal(validation.valid, false)
    assert.equal(validation.schemaError?.path, 'typography')
    // 解析失敗的草稿不進快取。
    const cache = (runtime as unknown as { validationCache: ContentHashCache<unknown> }).validationCache
    assert.equal(cache.size, 0)
    runtime.validate(builtinDefinition())
    assert.equal(cache.size, 1)
    assert.equal(cache.stats.misses, 1)

    const store = new UserPanelThemeStore(userData)
    let error: unknown
    try { store.create('Deep', payload) } catch (caught) { error = caught }
    assert.ok(error instanceof UserPanelThemeStoreError)
    assert.equal(error.code, 'invalid_definition')
    assert.equal(error.validation?.schemaError?.path, 'typography')
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
