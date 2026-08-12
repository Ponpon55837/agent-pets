# Agent Pets

Desktop pet that shows real-time status of your AI coding agents.

**English** | [繁體中文](README.zh-TW.md)

---

## Features

- **Real-time status** — See at a glance which agent is running, thinking, or idle.
- **Draggable pet** — Drag the pet anywhere on your screen (position is remembered across restarts).
- **Multi-agent support** — OpenCode, Codex, Claude Code (CLI & Desktop).
- **Custom pets** — Import your own spritesheet, or a `.codex-pet.zip` sprite kit from sites like [codex-pets.net](https://codex-pets.net).
- **Desktop controls** — Tray menu, native waiting/completion notifications, Do Not Disturb, sound control, and optional launch at startup.
- **Mini / Edge mode** — Mini is always opt-in; Edge Peek is a separate Settings/Tray toggle (off by default) that shows a dedicated Liquid Glass handle at the display edge instead of clipping the pet. Bounds are restored across display and DPI changes.
- **Permission Control** — OpenCode permission requests can be allowed once or denied from a Liquid Glass pet bubble; scoped hotkeys are available only while an eligible request is visible.
- **Pet progression** — Completed sessions, bounded observed active-time, first completions of the day, and consecutive-day streaks earn durable XP. Level and evolution are restored after restart from a main-process SQLite ledger.

---

## Supported Agents

| Agent | CLI | Desktop |
|-------|-----|---------|
| OpenCode | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Claude Code | ✅ | ✅ |

The **Generic HTTP** adapter is available to local integrations through the authenticated `/v1/events` endpoint. It is observe-only and has no permission-response capability.

---

## Quick Start

### Install (Windows)

Download and run `Agent Pets.exe` from the [Releases](https://github.com/Ponpon55837/agent-pets/releases) page. No installation needed — it's a portable app.

### Install (macOS)

Download `Agent Pets.dmg`, open it, and drag the app to your Applications folder.

### First Run

1. Launch Agent Pets. A small pet will appear on your screen.
2. Click the pet, then **⚙ → Setup Wizard**. It will detect which AI tools are installed on your machine.
3. Click **Install** next to a tool (or **Install All**) to wire up its hooks — the wizard does not do this automatically, you need to click.
4. Once hooks are installed, restart your coding tools; the pet's appearance will then change to reflect your agents' status.

---

## Usage

### Interacting with the Pet

| Action | Effect |
|--------|--------|
| **Left-click** the pet | Open the control panel (opens as its own window, next to the pet — the pet itself never moves) |
| **Drag** the pet | Move it to a new position (remembered across restarts) |
| **Right-click** | Nothing (disabled) |

The system Tray menu can show or hide the pets, open the panel or Settings, toggle Mini / Edge Peek mode, Do Not Disturb, sound and notifications, configure launch at startup in packaged builds, mark pending attention on the Tray icon, and quit the app. Closing or hiding the pet window keeps hooks and background status running until **Quit** is selected.

Below the pet, a floating status bar shows up to **3 lines**, one per active tool family (Codex / Claude / OpenCode). CLI and Desktop variants of the same tool are grouped onto a single line (e.g. `Claude (CLI+Desktop) · Thinking`). When nothing is active, a single line shows the pet's overall idle/offline state.

### Control Panel

Click the pet to open the control panel — a separate always-on-top window. It has two views. The main view contains **Sessions** and **Usage** tabs:

#### Sessions View (default)

Shows all sessions (including recently gone-offline ones) with their current status:

- **Idle** — Agent is waiting for input
- **Thinking** — Agent is processing
- **Tool Running** — Agent is executing a tool
- **Waiting Permission** — Agent is waiting for approval
- **Success** — Task completed successfully
- **Error** — An error occurred
- **Offline** — Session ended or went stale

Live states (Thinking / Tool Running / Waiting) show an elapsed-time readout next to the status. If any sessions are offline, a **Clear offline** button appears below the list to remove them from view.

#### Usage Tab

Shows the remaining subscription quota reported by Codex and Claude Code, including session/weekly windows, countdowns, and reset dates in the user's local time. While either family is active, a 3px quota meter is embedded inside its existing pet status pill without changing the window height; it prefers the short session window and falls back to weekly when that is the only quota returned. Hover the pill for the percentage and full reset time. **Agent Pets has no account system and never asks for an agent username, password, or token.** It reuses the local subscription session already created by Codex CLI or Claude Code, requests the provider's quota endpoint from the Electron main process, and only sends normalized percentages to the UI. If that CLI session is missing or expired, re-authentication happens in the original CLI—not in Agent Pets. Results are cached for one minute; the compact meter refreshes every five minutes while relevant agents are active, and **Refresh** requests a fresh reading for both windows. API-key-only Codex sessions do not expose subscription quota.

Click the **⚙** icon in the header to switch to Settings.

#### Settings View

The panel uses an extensible section navigator: **Appearance**, **Desktop**, **Pets**, **Growth**, and **Advanced**.

**Appearance section**

- **Size** — S / M / L / XL / XXL to scale the pet.
- **Bounce & shake** — Click/state-change bounce, idle fidget sway, and waiting-permission shake. **Off by default.**
- **Status bubble** — Ordinary success/error toasts close after about 3 seconds and show the remaining time; permission prompts never auto-dismiss. **Off by default.**

**Desktop section**

- **Mini mode** — Shrinks the pet to a compact 96px surface and can be turned off at any time.
- **Edge peek** — A separate, **off-by-default** preference. When enabled, dragging to a display edge and holding for about 650ms shows a dedicated 42px-thick × 96px-long Liquid Glass handle; click or hover expands back to Normal without leaving a clipped pet fragment. Pending permission requests always restore the normal interactive surface.
- **Do Not Disturb** — Suppresses native notifications, pet sounds, extra motion, and nonessential bubbles without stopping event ingestion. **Off by default.**
- **Notifications** — Native alerts for waiting-permission, waiting-input, completion, and errors. Repeats use a per-session cooldown and terminal events are batched. **On by default.**
- **Sound** — Short synthesized cues (Web Audio, no audio files) for success/error/waiting-permission. **Off by default.**
- **Launch at startup** — Start Agent Pets when you sign in. This toggle is available in packaged builds.
- **Permission Bubble** — An independent switch for the Liquid Glass Allow once / Deny card. Turning it off hides only the card; pending requests remain with the Broker, stay on the Tray badge, and can still be resolved by the Agent or terminal. **On by default.**

**Advanced section**
- **Setup Wizard** — Re-run tool detection, or install/reinstall hooks.
- **Restart Pet** — Fully relaunch Agent Pets if the pet or its animation gets stuck.
- **Quit** — Exit Agent Pets.

**Growth tab**

- **Mood** — Starts each day at a low baseline of 10. A successful task gives +4 and an error gives -6. Long tasks also earn +1 for every 2 completed tools (up to +8 per task) and +1 for every 5 minutes of work (up to +4 per task), so progress rewards are capped at +12 before the completion bonus. As mood grows, an animated energy layer built from the current pet frame intensifies around the pet's own silhouette, reaching overdrive at 90+. Click **Reset** to return to 10; it never grants extra mood.
- **Mood visuals** — Turn off mood's aura, color, and energy-layer presentation without stopping mood tracking; re-enable it at any time.
- **XP / Level** — The Growth chip shows the selected pet's durable XP, level, evolution stage, and current streak. XP uses a versioned, idempotent ledger: a canonical session completion is +20 XP, the first completion of a local day is +10, each observed 30 minutes of active coding is +2 (capped at +10 per session), and continuing yesterday's streak is +5. Failed or cancelled work grants no permanent XP; token milestones wait for an exact token event contract.

**Pets tab**

- **Pet** — Choose which pet to display. Click a pet name to select it.
- **+ Import Sprite** — Import a custom spritesheet (`.webp`/`.png`/`.jpg`, 8 columns × 11 rows).
- **+ Import .zip** — Import a `.codex-pet.zip` sprite kit (e.g. downloaded from codex-pets.net) in one click — no manual unzip needed.
- **Multi-pet** — Show one small pet per active tool family instead of collapsing to the single highest-priority one, when 2+ are running at once. **Off by default.** Per-agent pet choices appear here when enabled.

Click **‹** to return to the Sessions view.

---

## Setup Wizard

The Setup Wizard reads the runtime Agent Adapter registry and installs hooks when you click a button — it does not install anything on its own. Each adapter reports its supported sources, capabilities, health, and diagnosis checks:

- **OpenCode CLI / Desktop** — Writes a plugin to `~/.config/opencode/plugin/` (note: singular `plugin`, matching where OpenCode itself scans) and the platform's OpenCode Desktop plugin dir
- **Codex CLI** — Creates `~/.codex/hooks.json` and enables hooks in `~/.codex/config.toml`
- **Claude Code CLI & Desktop** — Adds a `hooks` block to `~/.claude/settings.json` (CLI and Desktop share this config, so one install covers both; which one actually fired an event is resolved at runtime via Claude Code's `CLAUDE_CODE_ENTRYPOINT` env var, not by the installer)

Each adapter shows a status dot and capability chips:

- 🟢 **Green** — Installed and configured
- 🟡 **Yellow** — Detected but not (fully) configured
- 🔴 **Red** — Error or unavailable

Click **Diagnose** to inspect bounded health checks. Click **Install** next to an installable adapter to (re)install just that integration, or **Install All** to run every adapter installer idempotently. Click **Refresh** if a status seems stale.

For a configured adapter, click **Test** to send a short-lived event through the running app's authenticated local HTTP receiver. A passing result confirms HTTP 204, adapter selection, canonical mapping, and renderer receipt in this Agent Pets instance; it does not launch the coding tool or prove that tool's hook has fired on its own. Generic HTTP is always observe-only and cannot respond to permissions.

> Note: there is no separate "Codex Desktop" hook install — only Codex CLI hooks are wired up today.

---

## Custom Pets

### Spritesheet Format

Custom pets use the same spritesheet format as built-in pets:

- **Format**: `.webp`, `.png`, or `.jpg` (built-in pets ship as `.webp`; imports of any of the three are copied in as-is and rendered by content, not by file extension)
- **Grid**: 8 columns × 11 rows (only rows 0–8 are currently used; 9 and 10 are reserved for future states)
- **Cell size**: 192 × 208 pixels

Each row represents a different state:

| Row | State |
|-----|-------|
| 0 | Idle / Offline |
| 5 | Error |
| 6 | Waiting Permission / Waiting Input |
| 7 | Thinking / Tool Running |
| 8 | Success |

### How to Import

**From a single spritesheet:**

1. Open the control panel (click the pet).
2. Click **⚙** to go to Settings.
3. Click **+ Import Sprite**.
4. Select a `.webp`/`.png`/`.jpg` spritesheet file.
5. The pet is added to your collection and automatically selected.

**From a `.codex-pet.zip` sprite kit** (e.g. downloaded from [codex-pets.net](https://codex-pets.net)):

1. Open the control panel → **⚙** → Settings.
2. Click **+ Import .zip** and select the downloaded `.zip`.
3. The app reads `pet.json` + the spritesheet inside automatically — no manual unzip required.

Custom pets are stored in `~/.desktop-pet/custom/`.

### How to Rename

1. Open the control panel (click the pet).
2. Click **⚙** to go to Settings.
3. Find the custom pet in the list.
4. Click the **✎** pencil icon next to the pet name.
5. Type the new name and press **Enter** (or click elsewhere to confirm).
6. Press **Esc** to cancel.

Built-in pets cannot be renamed.

### How to Remove / Hide

Click the **×** next to any pet in the list to remove it (you'll get a confirmation prompt first) — for custom pets this deletes the imported files; for built-in pets it just hides that pet from your own list (the bundled asset itself isn't touched). The default fallback pet (`aang-airbender`) has no **×** and can't be removed or hidden, so there's always at least one pet available.

---

## Event Server

Agent Pets runs a local HTTP server on `http://127.0.0.1:17373/v1/events` that receives status updates from hooks. Requests must include the per-install `X-Agent-Pets-Token` header; the managed hooks read it from the current user's permission-restricted `~/.desktop-pet/event-token` file automatically.

### POST /v1/events

```json
{
  "source": "codex",
  "sessionId": "sess_abc123",
  "state": "thinking",
  "timestamp": 1735689600000,
  "originalEvent": "UserPromptSubmit",
  "project": "/Users/you/my-project",
  "toolName": "Edit"
}
```

`source`, `sessionId`, `state`, and `timestamp` are required — a request missing any of them gets rejected with `400`. Missing or incorrect hook authentication is rejected with `401`.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | yes | `opencode-cli`, `opencode-desktop`, `codex`, `codex-desktop`, `claude`, `claude-desktop` (`opencode` is also accepted and normalized to `opencode-cli`) |
| `sessionId` | string | yes | Unique session identifier (max 256 chars) |
| `state` | string | yes | `idle`, `thinking`, `tool-running`, `waiting-permission`, `waiting-input`, `success`, `error`, `offline` (`waiting` is also accepted and normalized to `waiting-permission`) |
| `timestamp` | number | yes | Unix ms timestamp of the originating event |
| `project` | string | no | Project path (basename shown in UI) |
| `originalEvent` | string | no | The raw hook/event name that produced this, for debugging |
| `toolName` | string | no | Tool name, shown in the activity bubble while `tool-running` |

---

## Security

- **Renderer isolation** — Renderer processes run with Chromium sandboxing, context isolation, no Node.js integration, a restrictive CSP, a secure custom `agent-pets://` protocol instead of privileged `file://` pages, blocked popups/navigation, denied permissions, and validated main-frame IPC senders.
- **Local event server** — The event server listens on `127.0.0.1` only, authenticates every hook request with a per-install secret, rejects browser-originated and non-JSON requests, rate-limits events, and accepts only bounded, whitelisted fields.
- **Quota requests** — The quota feature connects only to the exact HTTPS Codex and Anthropic quota/auth endpoints. Redirects, oversized responses, excessive window counts, and malformed renderer IPC payloads are rejected. OAuth credentials stay in the Electron main process and are never exposed to the renderer or command-line arguments.
- **Credential refresh** — Expired OAuth tokens are refreshed and merged back into the original Codex auth file or Claude credential store so the CLIs keep working. Writes use account/change guards, restrictive file permissions, and atomic replacement where applicable.
- **Pet imports** — ZIP entry count, compressed/uncompressed sizes, JSON size, and image size/type are validated before imported files are stored.
- **Memory bounds** — Agent sessions are capped and stale/offline entries are evicted to prevent unbounded renderer memory growth.
- **Path sanitization** — Project paths are reduced to their basename, and filesystem destinations are constrained to their expected root.
- **Desktop notifications** — Notification text is built only from the normalized Agent name and bounded project basename; prompt text, tool arguments, session identifiers, and credentials are never shown or logged. Diagnostic notification history is bounded and stores only event class/outcome metadata.
- **Desktop preference IPC** — The main process owns Tray/DND/notification/permission-bubble/startup preferences. Renderer requests accept only an allowlist of boolean fields from validated first-party frames, and preference writes use bounded reads plus atomic replacement.
- **Permission Broker** — Permission responses use a separate loopback port and per-install token, never the generic event endpoint. The main process enforces TTL, one-shot state transitions, anti-replay, bounded records, Adapter-owned opaque handles, scoped hotkeys, external-resolution reconciliation, and a bounded redacted audit. Only `allow_once` and `deny` are exposed; permanent approval is intentionally unavailable.
- **Progression storage** — XP is awarded only in the Electron main process. SQLite migrations, transactionally coupled `pet_progress`/`xp_ledger` writes, unique idempotency keys, bounded session activity, and sanitized snapshots prevent renderer or duplicate-event writes from inflating progression. The database stays local and is never uploaded.
- **Packaged runtime** — Electron fuses disable RunAsNode, Node options/inspect arguments, and privileged `file://` behavior while enforcing ASAR-only loading and embedded ASAR integrity validation.
- **Release signing** — Production macOS and Windows artifacts should be built with the platform signing credentials configured; unsigned local builds are for development only.

---

## Development

### Prerequisites

- Node.js 22.12+
- pnpm 11+

### Setup

```bash
git clone https://github.com/Ponpon55837/agent-pets.git
cd agent-pets
pnpm install
```

### Run in Dev Mode

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

The output will be in `release/`.

### Unit Tests

```bash
pnpm test:unit
```

### Install Hooks (for development)

```bash
node integrations/install.mjs
```

This installs hooks for all detected tools. Hooks are installed to:

- `~/.codex/hooks.json` (Codex)
- `~/.claude/settings.json` (Claude Code CLI & Desktop)
- `~/.desktop-pet/agent-hook.mjs` + `agent-hook.cmd` (shared hook script all of the above call into)
- `~/.desktop-pet/event-token` (per-install event authentication secret; mode `0600` on macOS/Linux)

After upgrading an existing installation, Agent Pets refreshes managed hooks automatically. Restart a currently running OpenCode process once so its already-loaded plugin picks up event authentication.

Use `--claude-code` to install/uninstall the Claude Code hook only:

```bash
node integrations/install.mjs --claude-code
node integrations/install.mjs --uninstall --claude-code
```

---

## Project Structure

```
agent-pets/
├── electron/
│   ├── main.ts              # Electron main process
│   ├── agent-adapter.ts     # AgentAdapter contract and runtime registry
│   ├── agent-adapter-operations.ts # Platform-aware adapter detection/install bridge
│   ├── preload.ts           # IPC bridge
│   ├── event-server.ts      # HTTP event server
│   ├── event-normalizer.ts  # Generic event allowlist and projection
│   ├── permission-broker.ts # Permission state machine and anti-replay
│   ├── permission-adapter-server.ts # Dedicated OpenCode response channel
│   ├── permission-audit.ts  # Bounded redacted local audit
│   ├── progression.ts       # SQLite XP ledger and level projection
│   ├── pet-window-mode.ts   # Bounded Mini/Edge geometry and dwell constants
│   ├── desktop-preferences.ts # Main-owned desktop preferences
│   ├── desktop-notifications.ts # Native notification delivery and bounded log
│   ├── desktop-tray.ts      # Tray lifecycle and menu
│   ├── notification-policy.ts # Pure notification classification/cooldown
│   ├── quota.ts             # Codex / Claude quota readers
│   └── setup.ts             # Platform-aware paths & setup
├── integrations/
│   ├── install.mjs          # Standalone CLI hook installer
│   ├── agent-hook.mjs       # Shared hook script (bundled into the app via extraResources)
│   └── agent-hook.cmd       # Windows wrapper for agent-hook.mjs
├── src/
│   ├── components/
│   │   ├── DesktopPet.vue   # Pet window (drag + click)
│   │   ├── PetAnimation.vue # Canvas spritesheet renderer
│   │   ├── StatusPanel.vue  # Unified control panel
│   │   └── SetupWizard.vue  # Tool detection + install wizard
│   ├── stores/
│   │   └── agentStore.ts    # Pinia store (sessions, pets, UI state)
│   ├── types/
│   │   ├── agent.ts         # Agent event types
│   │   ├── agent-adapter.ts  # Adapter capabilities/status contracts
│   │   └── desktop.ts       # Desktop preference IPC types
│   └── utils/
│       ├── format.ts        # Shared formatting helpers
│       └── sound.ts         # Synthesized audio cues (Web Audio API)
├── public/
│   └── pets/
│       ├── pets.json        # Built-in pet manifest (id/displayName/folder)
│       └── <pet-id>/        # spritesheet.webp + pet.json per built-in pet
├── tests/                   # Node built-in unit tests
├── package.json
└── README.md
```

The app's own install/uninstall logic (used by the Setup Wizard's buttons) lives in `electron/setup.ts`, in-process — `integrations/install.mjs` is the standalone equivalent for running from a terminal (see [Install Hooks (for development)](#install-hooks-for-development) above); both generate the same hook scripts and plugin content, kept in sync by hand.

---

## License

MIT — see [LICENSE](LICENSE). The quota integration is based on the MIT-licensed [TokenBar](https://github.com/Nanako0129/TokenBar); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
