# Agent Pets project map

## Runtime and tooling

- Stack: Electron 43, Vue 3, Pinia, TypeScript, Vite, electron-builder.
- Package manager: `pnpm@11.16.0`; authoritative lockfile: `pnpm-lock.yaml`.
- Current baseline when this reference was written: `0.5.7`. Always re-read `package.json` because this value will change.
- Renderer entry: `src/main.ts` and `src/App.vue`.
- Electron composition root: `electron/main.ts`.
- Preload boundary: `electron/preload.ts`; matching global types: `src/env.d.ts`.
- Event ingress: `electron/event-server.ts`, loopback port `17373`, token header `x-agent-pets-token`.
- Generic event allowlist projection: `electron/event-normalizer.ts`; capability contract: `src/types/capabilities.ts`.
- Permission Control: `electron/permission-broker.ts` owns state/TTL/anti-replay; `electron/permission-adapter-server.ts` is the token-authenticated OpenCode relay on loopback port `17374`; `electron/permission-audit.ts` persists bounded redacted terminal records; shared view/decision types are in `src/types/permission.ts`.
- Progression: `electron/progression.ts` owns the main-process SQLite migration, XP ledger, idempotency, observed active-time and streak projection; pure level/evolution policy and sanitized snapshots live in `src/types/progression.ts`.
- Phase 2 threat model: `docs/security/phase-2-permission-broker-threat-model.md`.
- Hook installation and repair: `electron/setup.ts` and `integrations/`.
- Quota adapters: `electron/quota.ts`.
- Desktop preferences: `electron/desktop-preferences.ts`; canonical shared types: `src/types/desktop.ts`.
- Tray and native notification runtime: `electron/desktop-tray.ts`, `electron/desktop-notifications.ts`, and `electron/notification-policy.ts`.
- Realtime state and current local persistence: `src/stores/agentStore.ts`.
- Pet surface: `src/components/DesktopPet.vue` and `src/components/PetAnimation.vue`.
- Panel/settings surface: `src/components/StatusPanel.vue` and `src/components/SetupWizard.vue`.
- Canonical current event types: `src/types/agent.ts`.

## Existing security controls to preserve

- Chromium sandbox and context isolation enabled; Node integration disabled.
- Custom secure `agent-pets://` protocol used instead of privileged renderer file access.
- External navigation, popups, permission requests, and untrusted IPC senders are rejected.
- Event server limits body size, text length, rate, sources, and states, and requires a local token.
- Imported pet archives and raster files have size, count, path, and signature constraints.
- electron-builder fuses disable run-as-node, Node options, CLI inspection, and extra file privileges.

## Current product behavior

- Mood is renderer-local and resets by local date/version.
- XP progression is main-owned and durable in `progression.sqlite`; the current selected pet is synchronized through typed IPC, while mood remains short-term and renderer-local. Generic events and MCP presentation intents never award XP.
- Pet selection, scale, multi-pet, reactions, bubbles, hidden pets, and family mappings use `localStorage`.
- DND, notifications, permission-bubble visibility, sound, and launch-at-startup are main-owned desktop preferences persisted under Electron `userData`; legacy sound is migrated once from renderer storage. Hiding the permission bubble never changes Broker state or the Tray attention badge.
- Tray is a main-process singleton. Closing the pet hides it, while a destroyed renderer can be rebuilt through the existing main process.
- Main process persists window position/size through helpers in `electron/setup.ts`.
- Status events feed the Pinia store through the typed preload listener.
- Click-through combines renderer hit testing and Electron mouse passthrough.
- Three Agent families are supported through hooks: Codex, Claude Code, and OpenCode.
- OpenCode is currently the only respond-capable permission Adapter. Generic `/v1/events` remains observe-only; Codex and Claude show external-only waiting state until a verified response channel exists.

## Working rules

- Keep unrelated `.claude/`, local MCP configs, build output, and user settings untouched.
- Before packaging, identify processes by executable path. The user explicitly allows closing `release/win-unpacked/Agent Pets.exe` when it locks this project's build output; do not terminate other Agent Pets installations or unrelated Electron processes.
- Prefer narrow feature modules over adding more policy directly to `electron/main.ts`.
- Keep `electron/preload.ts` and `src/env.d.ts` synchronized when IPC changes.
- Update both English and Traditional Chinese README sections when user-visible behavior changes.
- Inspect the final diff and distinguish pre-existing warnings or failures from phase regressions.
