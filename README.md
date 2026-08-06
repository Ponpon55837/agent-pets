# Agent Pets

Desktop pet that shows real-time status of your AI coding agents.

**English** | [繁體中文](README.zh-TW.md)

---

## Features

- **Real-time status** — See at a glance which agent is running, thinking, or idle.
- **Draggable pet** — Drag the pet anywhere on your screen (position is remembered across restarts).
- **Multi-agent support** — OpenCode, Codex, Claude Code (CLI & Desktop).
- **Custom pets** — Import your own spritesheet, or a `.codex-pet.zip` sprite kit from sites like [codex-pets.net](https://codex-pets.net).

---

## Supported Agents

| Agent | CLI | Desktop |
|-------|-----|---------|
| OpenCode | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Claude Code | ✅ | ✅ |

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

Below the pet, a floating status bar shows up to **3 lines**, one per active tool family (Codex / Claude / OpenCode). CLI and Desktop variants of the same tool are grouped onto a single line (e.g. `Claude (CLI+Desktop) · Thinking`). When nothing is active, a single line shows the pet's overall idle/offline state.

### Control Panel

Click the pet to open the control panel — a separate always-on-top window. It has two views:

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

Click the **⚙** icon in the header to switch to Settings.

#### Settings View

The panel is split into **Settings** and **Pets** tabs.

**Settings tab**

- **Size** — S / M / L / XL / XXL to scale the pet.
- **Mood** — A meter that nudges up on task success and down on error; purely cosmetic, tints the pet with a warm glow (high mood) or a slight dim (low mood) — applied across every state, not just idle. Resets to baseline automatically at the start of each new day, or click **Reset** to do it manually (always goes back to exactly baseline — not something you can farm higher by spamming it).
- **Sound** — Short synthesized cues (Web Audio, no audio files) for success/error/waiting-permission. **Off by default.**
- **Bounce & shake** — Click/state-change bounce, idle fidget sway, and waiting-permission shake. **Off by default.**
- **Bubble** — The completion toast and "what's it doing" activity bubble above the pet. **Off by default.**
- **Setup Wizard** — Re-run tool detection, or install/reinstall hooks.
- **Restart Pet** — Fully relaunch Agent Pets if the pet or its animation gets stuck.
- **Quit** — Exit Agent Pets.

**Pets tab**

- **Pet** — Choose which pet to display. Click a pet name to select it.
- **+ Import Sprite** — Import a custom spritesheet (`.webp`/`.png`/`.jpg`, 8 columns × 11 rows).
- **+ Import .zip** — Import a `.codex-pet.zip` sprite kit (e.g. downloaded from codex-pets.net) in one click — no manual unzip needed.
- **Multi-pet** — Show one small pet per active tool family instead of collapsing to the single highest-priority one, when 2+ are running at once. **Off by default.** Per-agent pet choices appear here when enabled.

Click **‹** to return to the Sessions view.

---

## Setup Wizard

The Setup Wizard detects each tool's config, and installs its hooks when you click a button — it does not install anything on its own:

- **OpenCode CLI / Desktop** — Writes a plugin to `~/.config/opencode/plugin/` (note: singular `plugin`, matching where OpenCode itself scans) and the platform's OpenCode Desktop plugin dir
- **Codex CLI** — Creates `~/.codex/hooks.json` and enables hooks in `~/.codex/config.toml`
- **Claude Code CLI & Desktop** — Adds a `hooks` block to `~/.claude/settings.json` (CLI and Desktop share this config, so one install covers both; which one actually fired an event is resolved at runtime via Claude Code's `CLAUDE_CODE_ENTRYPOINT` env var, not by the installer)

Each tool shows a status dot:

- 🟢 **Green** — Installed and configured
- 🟡 **Yellow** — Detected but not (fully) configured
- 🔴 **Red** — Not detected

Click **Install** next to a tool to (re)install just that integration, or **Install All** to do everything at once. Click **Refresh** if a tool's status seems stale.

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

Agent Pets runs a local HTTP server on `http://127.0.0.1:17373/v1/events` that receives status updates from hooks.

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

`source`, `sessionId`, `state`, and `timestamp` are required — a request missing any of them gets rejected with `400`.

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

- **Local only** — Server listens on `127.0.0.1` only; no network access.
- **Body limit** — Requests are limited to 64 KB.
- **State whitelist** — Only valid states are accepted; unknown states are rejected.
- **Path sanitization** — Project paths are truncated to basename only; no full paths leak into the UI.

---

## Development

### Prerequisites

- Node.js 18+
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

### Install Hooks (for development)

```bash
node integrations/install.mjs
```

This installs hooks for all detected tools. Hooks are installed to:

- `~/.codex/hooks.json` (Codex)
- `~/.claude/settings.json` (Claude Code CLI & Desktop)
- `~/.desktop-pet/agent-hook.mjs` + `agent-hook.cmd` (shared hook script all of the above call into)

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
│   ├── preload.ts           # IPC bridge
│   ├── event-server.ts      # HTTP event server
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
│   │   └── agent.ts         # TypeScript types
│   └── utils/
│       ├── format.ts        # Shared formatting helpers
│       └── sound.ts         # Synthesized audio cues (Web Audio API)
├── public/
│   └── pets/
│       ├── pets.json        # Built-in pet manifest (id/displayName/folder)
│       └── <pet-id>/        # spritesheet.webp + pet.json per built-in pet
├── package.json
└── README.md
```

The app's own install/uninstall logic (used by the Setup Wizard's buttons) lives in `electron/setup.ts`, in-process — `integrations/install.mjs` is the standalone equivalent for running from a terminal (see [Install Hooks (for development)](#install-hooks-for-development) above); both generate the same hook scripts and plugin content, kept in sync by hand.

---

## License

MIT — see [LICENSE](LICENSE).
