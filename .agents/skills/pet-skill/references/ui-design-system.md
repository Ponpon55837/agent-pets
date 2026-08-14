# UI design system

This project has a token layer and a shared primitive component set. They exist because the panel used to accumulate divergent one-off styles per feature (five card treatments, twelve button styles, nine progress-bar implementations, a dropdown that never disabled the native OS arrow). Read this before writing or editing any `.vue` file under `src/components/`.

Full audit and rationale: [UI-Audit-And-Redesign-Plan.zh-TW.md](../../../docs/design/UI-Audit-And-Redesign-Plan.zh-TW.md).

## Rule: no bare hex or rgba(), no naked font-size

Every colour, font size, spacing, radius, and shadow in a component `<style>` block must be a `var(--token)` from `src/styles/tokens.css`. A literal `#8b9cf7` or `rgba(139, 156, 247, 0.15)` in a new `.vue` file is a bug, not a style choice — it cannot be themed, cannot be audited, and is how the app ended up with 121 unique hex values and 9px body text.

If the colour/size you need does not have a token yet, add one to `tokens.css` (with a comment explaining what it is for) rather than inlining a literal. Keep the token count small — reuse an existing token before adding a near-duplicate.

The floor for any user-facing text is `--font-xs` (11px). CJK glyphs lose stroke definition below that on both Windows and macOS; do not add a smaller size to "make it fit" — that is a symptom of the container being too small, not a font-size problem (see the panel-sizing note below).

## Rule: reuse the primitive before writing a new element

`src/components/ui/` holds the app's only implementations of these UI patterns. Import them; do not hand-roll a competing version.

| Component | Replaces | Use for |
| --- | --- | --- |
| `Button.vue` | any `<button class="...">` with custom styling | Every clickable action. Pick `variant` by role — `primary` (section's main action), `secondary` (supporting: refresh, reset, export), `danger` (destructive: quit, remove, clear), `ghost` (icon-only chrome: header controls, inline row actions). Never introduce a 13th button style. |
| `Card.vue` | any `.xxx-card` / bordered content block | Grouping settings, stats, or list content. Default `tone="neutral"`. Reach for `accent` / `success` / `claude` / `warn` only when the card shares a real semantic identity with other UI using that colour elsewhere in the panel (sessions/streak = success, token/growth numbers = accent, Claude's own quota card = claude, a status that needs attention = warn) — colouring every card is the "monotone panel" problem in reverse (a wall of noise instead of a wall of grey) and was explicitly walked back once already. |
| `ToggleRow.vue` | hand-written `<label class="toggle-row">` + switch markup | Every on/off setting. Takes `label`, optional `help`, `v-model` boolean. |
| `Select.vue` | any `<select>` | Every dropdown. Wraps the native `<select>` (kept native on purpose — a custom listbox would get clipped by the panel's `overflow: hidden` in this frameless window, and loses OS keyboard/typeahead behaviour) but takes over `appearance` and the closed-state chrome so both platforms render identically. If you write a raw `<select>` anywhere, that is the bug this component exists to prevent. |
| `ProgressTrack.vue` | any percentage bar (`quota-track`, `mood-bar`, day-activity bars, etc.) | Any 0–100 value shown as a bar. `tone` picks the fill colour family; `decorative` drops the `role="progressbar"` ARIA wiring for bars that are visual-only. |
| `ConfirmDialog.vue` | `window.confirm(...)` | Every destructive/irreversible action (remove, clear, delete). Never call `window.confirm` or `window.alert` — the native dialog steals OS focus, which the main process reads as the panel window losing focus, which hides the panel out from under the confirmation. It also renders as a different native surface on Windows vs. macOS, which is the kind of cross-platform inconsistency this whole system exists to avoid (see the platform note below). |
| `Icon.vue` | any Unicode/emoji glyph used as a UI icon | Any icon in chrome (nav, buttons, section headers). Plain text glyphs (`⌘ ◈ ✦`) render through the OS font and differ in weight/alignment between Windows and macOS, and some carry unrelated platform meaning (`⌘` is the macOS Command key — do not reuse it as a generic symbol). Add new icons as inline path data in `Icon.vue`'s `paths` map; keep them on the existing 16×16 grid with 1.4 stroke-width so a new icon does not look heavier or lighter than the rest. |

Session state labels (`STATE_LABELS` / `STATE_LABELS_SHORT` in `src/types/agent.ts`) and `SOURCE_LABELS` (Codex CLI, OpenCode Desktop, …) are deliberately **not** localized — they're the agent's technical run states and product/vendor names, not prose, and stay English in every locale. This was tried the other way (routed through `t()`) and reverted: translating "Thinking"/"Idle" read as inconsistent next to the untranslated tool vocabulary the rest of the panel already uses. Don't route these through `t()` again; add new state/source copy directly to the constant maps in `types/agent.ts`.

## Cross-platform is the constraint, not an afterthought

This app ships for **both Windows (portable) and macOS (dmg)** — see `package.json` `build.win` / `build.mac`. A design decision that only works on one platform is wrong, not a rare edge case:

- Never rely on a plain Unicode/emoji character as a UI icon — use `Icon.vue`. Font fallback, glyph coverage, and optical weight differ by platform and there is no CSS that fixes it after the fact.
- Never use `window.confirm` / `window.alert` / `window.prompt` — the native chrome differs by platform (Windows message box vs. macOS sheet), and it steals focus in a way that breaks this app's panel specifically (see above). Use `ConfirmDialog.vue`.
- When touching `electron/main.ts` window-geometry code (`computePanelBounds`, `animateBounds`, edge/mini mode), verify against both platforms' `workArea` semantics — macOS excludes the menu bar and Dock, Windows excludes the taskbar, and they are not the same shape.
- CJK text and Latin text do not share font metrics; do not assume a string's rendered width or vertical alignment is portable across `zh-TW` / `en-US` without checking both.

## Panel sizing is content-driven, not per-view constants

Historically each panel view (`Sessions`, `Usage`, `History`, `Settings`, Project MCP) requested a hardcoded pixel size via `resizePanel(height, width)` in `src/stores/agentStore.ts`. That is why History (six-plus cards, a 7-day chart, quota snapshot) was squeezed into the same 380×380 box as a two-line session list, and why body text kept shrinking to fit. If you add content to a panel view, do not reach for a new hardcoded `resizePanel()` call — prefer a layout that scrolls within the existing bounds, and flag to the user if the view now structurally needs more room (that is a sizing-strategy change, not a per-feature one).

## Layer rules (Liquid Glass)

See [liquid-glass.md](liquid-glass.md) for the full material/motion contract. The short version relevant to the primitives above: `--surface-panel` + `--surface-blur` belong on the outer glass container only (`.status-panel`, `ConfirmDialog`'s scrim). Everything inside — cards, rows, buttons — uses a flat `--surface-raised` tint, never a second `backdrop-filter`. Glass-on-glass is a repeated regression, not a style preference.

## When you're done

- Run `npx vue-tsc --noEmit`, `pnpm build`, and `pnpm test:unit` — all three must be clean before treating a UI change as finished (see `phase-gates.md`).
- If you touched `StatusPanel.vue`, `SetupWizard.vue`, or `ProjectMcpPanel.vue`, grep the file's `<style>` block for bare `#`/`rgba(` and any `font-size: <number>px` literal below `11px` — none should exist post-edit.
- If you added a new interactive element, confirm it is reachable by keyboard (`tabindex`, visible `:focus-visible`) and does not nest a `<button>`-rendering component inside another `<button>` — the browser silently closes the outer tag early, which breaks both the outer click target and whatever was nested inside it. Use `role="button"` + `tabindex="0"` + explicit `keydown` handling on a non-button container when a clickable element needs to contain other buttons.
