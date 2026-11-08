# Theme token audit (raw colours outside the theme palette)

Work list for spec §16 (one theme for every surface). Generated from `node scripts/check-design-tokens.mjs --raw-colors`, which lists every literal colour (hex, `rgb()`/`hsl()`/`oklch()` and other colour functions, CSS named colours in colour properties, colour strings in TS and Vue scripts) in `src/**`. The only allowed source of literal colours is the theme palette layer `--builtin-organic-*` in `src/styles/tokens.css` (the built-in values that plugin themes replace).

Baseline on `feat/panel-themes` after the `--ap-*` read API: **141 raw colours**, 129 in `tokens.css` and 12 elsewhere. Every component stylesheet already reads colours through `var()`; the literals sit in token blocks that are not driven by the theme, plus three component literals and two TS/Vue colour tables.

## Enforcement

- Now (baseline): `raw-color` is reported in the summary (`rawColors`, `rawColorsByGroup`) and does not fail `check:design` or `check:design:strict`.
- Switch (end of step 2): when the count reaches 0, change the `check:design:strict` script in `package.json` to `node scripts/check-design-tokens.mjs --strict --raw-colors=fail`. From then on any raw colour outside `--builtin-organic-*` fails CI. `shouldFail()` in the script and `tests/check-design-tokens.test.mts` already cover the flag.

## Summary by surface

"Target" names the theme palette key each group should read in step 2 (manifest keys from spec §3.2; *new* marks a key §16.2 still has to add, derived from the core keys so existing themes stay valid).

| Group | Count | Where it renders | Target |
| --- | --- | --- | --- |
| `shared-glass-layer` | 36 | `:root` defaults of `--surface-*`, `--text-*`, `--accent*`, `--border-*`, `--state-*`: every component rendered outside `.status-panel` (setup wizard, Project MCP panel, pet window, plugin pages via `_shared/tokens.css`). Inside `.status-panel` these names are already aliased to the palette. | surface levels, text levels, accent family, border/borderSoft, state text, scrim (see table below) |
| `pet-bubbles` | 30 | Pet speech, success/error/warn/info/plugin bubbles and the permission bubble, dark and light pet appearance | *new* `bubbleSurface` (derived from `surface`), `text`, state text, `accentText` for info, *new* `pluginTint` |
| `pet-status-pill` | 27 | Status pill, quota tooltip and edge track in the pet window (built-in values when no `petStatus` is declared) | `petStatus.*` (§3.7) falling back to `surface`/`text`/`border`; shadows to *new* elevation tokens |
| `pet-window-glass-light` | 12 | Light pet appearance overrides of the glass layer inside `.desktop-pet` | same targets as `shared-glass-layer`, light mode |
| `agent-state-colours` | 10 | `STATE_COLORS` in `src/types/agent.ts` (pet status dots, mini ring, session rows) and `--state-idle`/`--state-offline` | `successText`, `warnText`, `dangerText`, `accent` (thinking/tool), `textMuted` (idle/offline); move the TS table to `var(--state-*)` names |
| `panel-elevation` | 8 | `--organic-{panel,card,hero,thumb}-shadow`, light and dark | *new* `shadow` colour (derived: `text` at low alpha in light, black in dark) |
| `agent-brand` | 4 | Claude brand gradient, accent, border and surface on cards | keep as brand constants, or *new* `brandClaude`; decide in step 2 (brand colours are identity, not theme) |
| `scrollbars` | 4 | `--scrollbar-thumb(-hover)` dark and light | `text` at 0.2–0.45 alpha (derived) |
| `pet-window-chrome` | 4 | Drag shadow (dark/light), edge-peek handle shadow, the error badge `color: white` in `DesktopPet.css:258` | elevation tokens; badge text to `onAccent`-style *new* `onDanger` |
| `quota-meters` | 3 | `--organic-quota-warning/error/sage` | `warnText`, `dangerText`, `sage`; the < 20 % critical colour stays host-fixed per §3.7 |
| `shared-controls` | 2 | Primary button hover `color-mix(… 88%, black)` in `src/components/ui/Button.vue:147-148` | `accentHover` (already validated against `onAccent`) |
| `pet-sprite-effects` | 1 | Aura tint `rgb(235, 242, 255)` in `src/components/PetAnimation.vue:132` | sprite effect, not UI chrome: keep host-fixed or read `accent`; decide in step 2 |

## `shared-glass-layer` and `pet-window-glass-light` mapping

| Token | Dark default | Target |
| --- | --- | --- |
| `--surface-panel`, `--surface-overlay`, `--surface-option` | `rgba(18,18,26,.86)`, `rgba(25,25,35,.98)`, `#1b1b29` | `bg` / *new* `overlay` (popover, menu, dialog, toast; derived from `surface`) |
| `--surface-raised`, `--surface-raised-hover`, `--surface-sunken` | translucent white / black | `surface`, `surface2`, *new* `sunken` (derived from `bg` toward `text`) |
| `--surface-scrim` | `rgba(0,0,0,.5)` | `scrim` |
| `--text-primary`, `--text-bright`, `--text-on-option` | `#e8ecfa`, `#f1f3ff`, `#ddd` | `text` |
| `--text-secondary`, `--text-muted` | `#a4a8b4`, `#858b9b` | `textSecondary`, `textMuted` |
| `--accent`, `--accent-bright`, `--accent-on` | `#8b9cf7`, `#cdd4ff`, `#12121a` | `accent`, `accentText`, `onAccent` |
| `--accent-wash/soft/strong/glow`, `--border-accent(-strong)` | accent at 0.08–0.4 | `accent` with fixed alphas (derived) |
| `--gradient-accent` | `#667eea → #8b9cf7` | `accent` → `accentHover` |
| `--border-subtle`, `--border-strong` (+ `prefers-contrast` block) | white 0.08 / 0.14 (0.3 / 0.5) | `borderSoft`, `border` |
| `--state-success`, `--state-error(-soft)`, `--state-warn(-bright)`, `--state-info` | `#50c878`, `#ff6b6b`, `#c8b450`, `#9dd8ff` | `successText`, `dangerText`, `warnText`, *new* `info` (today `accentText`, as `--ap-info`) |
| `--focus-ring-color-on-light` | `#1b5fb0` / `#9dd8ff` | `accent` (focus follows accent, §3.4); token currently unused |
| `--shadow-raised`, `--text-shadow-panel` | white inset 0.06, black 0.55 | elevation tokens |

## Pre-existing findings carried into step 2

- `DesktopPet.css:258` uses the named colour `white` for the error badge text, and `Button.vue` mixes the primary hover with `black`; neither follows the light pet appearance or a theme.
- `STATE_COLORS` duplicates `--state-*` values in TS, so a palette change must be made twice today.
- `--focus-ring-color-on-light` is declared (light and dark) but never read; remove it or use it for the unified focus ring.

## Unused tokens (`check:design --verbose`, 20)

`tokens.css` is also served read-only to plugin pages as `agent-pets://plugin/_shared/tokens.css`, so its definitions stay until step 2 decides each case. The checker now counts `var(--x)` inside TS and Vue script/template strings as a use (the pet quota colours were misreported as unused before).

| Tokens | Status | Step 2 decision |
| --- | --- | --- |
| `--accent-strong`, `--border-claude`, `--surface-claude`, `--font-xl` | Never read. The dead re-declarations in `StatusPanel.css`, `SetupWizard.css` and `ProjectMcpPanel.css` are removed; the `tokens.css` definitions remain for plugin pages. | Keep in `tokens.css` while plugin pages may use them; the re-tokenised surfaces must not reintroduce panel-scope copies. |
| `--color-bg` … `--color-scrim` (12 semantic aliases of the palette) | Declared as "the names new panel-layer CSS should use", never adopted. They mirror the `--ap-*` colour subset 1:1. | Adopt as the internal semantic layer that every re-tokenised surface reads (and extend with the *new* keys above), or delete; do not keep two unused layers. |
| `--accent-primary`, `--surface-secondary`, `--font-2xs` | Compatibility aliases for references that were removed in the UX overhaul; not in the documented plugin token table. | Delete once step 2 confirms no component or documented plugin token uses them. |
| `--font-floor` | 11 px helper for `max(var(--font-floor), calc(11px * var(--pet-scale)))`; the pet bubbles use `max(var(--font-xs), …)` (also 11 px) instead. | Use it in the pet window's scaled text when that CSS is re-tokenised, otherwise delete. |
