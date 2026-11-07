# Design follow-ups for other streams

Violations found by the design stream in files it does not own. Each item names the file and what to change; the new tokens/primitives are already available.

## Focus (DS-08)
- `src/components/StatusPanel.css` (`.pet-rename-input`, ~line 1217): `outline: none` with only a 1px border change. Delete the `outline: none`; the global `:focus-visible` ring (base.css) applies. Add `aria-label` in `SettingsPets.vue` or switch to `ui/Input.vue`.
- `src/components/DesktopPet.css` (`.permission-button`, ~line 875): `outline: none` + hand-written box-shadow ring using a bare hex. Remove and rely on the global ring, or use `--focus-ring-*`.
- `role="button" tabindex="0"` elements (`.pet-option` in `SettingsPets.vue`, `.plugin-badge-anchor` in `DesktopPet.vue`, `.quota-*` tabindex elements) get the global ring automatically; do not add `outline: none` to them.

## Dialogs (DS-11)
- `SetupWizard.vue` (`role="dialog" aria-modal` at ~164) and `ProjectMcpPanel.vue` (~168): no Esc, no focus trap, no initial focus, no focus restore. Wrap their body in `ui/Dialog.vue` (props: `open`, `title`, `description`, `role`, `initial-focus`, `show-close`; `#footer` slot; emits `close`). `Dialog` drives `useDialogA11y` (Esc, Tab trap, initial focus, restore, `inert` on the overlay's siblings) and replaces the per-file `blur(4px)` scrims (`--blur-scrim`). If the wizard must keep its own overlay element, call `useDialogA11y({ open, container, scope, onClose })` directly.
- `PluginPanelDialogs.vue` already uses `ConfirmDialog` and inherits the new behaviour; native checkbox at ~83 should become `ui/Checkbox.vue`.

## Tabs (DS-12)
- `StatusPanel.vue` dashboard tabs (~195) and settings nav (~221) duplicate a hand-written tablist (`onTabKeydown` / `onSettingsKeydown`). Replace with `ui/Tabs.vue` (`v-model`, `:items`, `:aria-label`, `id-prefix`) and wrap the three dashboard views and settings content in `ui/TabPanel.vue`. Settings nav: `orientation="vertical"`, wrapped in a `<div>` or an outer `<nav>` (not `<nav role="tablist">`). Use `variant="underline"` for dashboard tabs and `variant="pill"` for the settings nav so one token-driven active style replaces `.dashboard-tab.active` / `.settings-nav-item.active`.

## Hit areas, z-index, motion tokens (DS-17)
Replace literals with tokens (`--hit-min`, `--z-*`, `--transition-*`); for visually small controls extend the hit area with an `::after` inset (see `ui/Button.vue`) instead of changing layout.
- `DesktopPet.css`: controls at ~94 (28px), ~776 (24px, plugin-feed-close), ~1085 (22px).
- `StatusPanel.css:~1054` (26px control); `ProjectMcpPanel.css:~140` (30px); `PluginPanel.css:9` (32px ok) and `PluginPanel.css:3` `z-index: 10000` -> `var(--z-system)`.
- 17 `z-index` literals across DesktopPet/StatusPanel/PluginPanel/SetupWizard/ProjectMcp -> `--z-sticky/popover/modal/toast/system`.
- ~46 `transition:` declarations without `var(--transition-*)` in DesktopPet/StatusPanel/PluginPanel.
- Card tones: `ui/Card.vue` still supports all five (backward compatible); new code should use neutral/accent/danger and express other meaning with `ui/Badge.vue`.
- Fonts: Caprasimo/Figtree were never bundled; `--organic-font-heading` now honestly falls back to Georgia and body to the system stack. If a font is bundled later, add `@font-face` + THIRD_PARTY_NOTICES in the same change.
