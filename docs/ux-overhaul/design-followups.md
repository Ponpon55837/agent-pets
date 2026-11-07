# Design follow-ups for other streams

Violations found by the design stream in files it does not own. Each item names the file and what to change; the new tokens/primitives are already available.

## Focus (DS-08)
- `src/components/StatusPanel.css` (`.pet-rename-input`, ~line 1217): `outline: none` with only a 1px border change. Delete the `outline: none`; the global `:focus-visible` ring (base.css) applies. Add `aria-label` in `SettingsPets.vue` or switch to `ui/Input.vue`.
- `src/components/DesktopPet.css` (`.permission-button`, ~line 875): `outline: none` + hand-written box-shadow ring using a bare hex. Remove and rely on the global ring, or use `--focus-ring-*`.
- `role="button" tabindex="0"` elements (`.pet-option` in `SettingsPets.vue`, `.plugin-badge-anchor` in `DesktopPet.vue`, `.quota-*` tabindex elements) get the global ring automatically; do not add `outline: none` to them.
