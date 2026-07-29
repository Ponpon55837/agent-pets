# Agent Pets

Desktop pet that shows real-time status of your AI coding agents.

# AI 編程助手桌面寵物

顯示 AI 編程助手即時狀態的桌面寵物。

---

## Features / 功能

- **Real-time status** — See at a glance which agent is running, thinking, or idle.
- **Draggable pet** — Drag the pet anywhere on your screen.
- **Multi-agent support** — OpenCode, Codex, Claude Code (CLI & Desktop).
- **Custom pets** — Import your own spritesheets.

---

## Supported Agents / 支援的工具

| Agent | CLI | Desktop |
|-------|-----|---------|
| OpenCode | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Claude Code | ✅ | ✅ |

---

## Quick Start / 快速開始

### Install (Windows)

Download and run `Agent Pets.exe` from the [Releases](https://github.com/yourname/agent-pets/releases) page. No installation needed — it's a portable app.

### Install (macOS)

Download `Agent Pets.dmg`, open it, and drag the app to your Applications folder.

### First Run

1. Launch Agent Pets. A small pet will appear on your screen.
2. The **Setup Wizard** opens automatically. It will detect which AI tools are installed on your machine.
3. Follow the wizard to install hooks for each detected tool.
4. Once hooks are installed, the pet's appearance will change to reflect your agents' status.

---

## Usage / 使用方式

### Interacting with the Pet / 與寵物互動

| Action | Effect |
|--------|--------|
| **Left-click** the pet | Open the control panel (opens as its own window, next to the pet — the pet itself never moves) |
| **Drag** the pet | Move it to a new position |
| **Right-click** | Nothing (disabled) |

Below the pet, a floating status bar shows up to **3 lines**, one per active tool family (Codex / Claude / OpenCode). CLI and Desktop variants of the same tool are grouped onto a single line (e.g. `Claude (CLI+Desktop) · Thinking`). When nothing is active, a single line shows the pet's overall idle/offline state.

### Control Panel / 控制面板

Click the pet to open the control panel — a separate always-on-top window. It has two views:

#### Sessions View (default)

Shows all active agent sessions with their current status:

- **Idle** — Agent is waiting for input
- **Thinking** — Agent is processing
- **Tool Running** — Agent is executing a tool
- **Waiting Permission** — Agent is waiting for approval
- **Success** — Task completed successfully
- **Error** — An error occurred

Click the **⚙** icon in the header to switch to Settings.

#### Settings View

- **Pet** — Choose which pet to display. Click a pet name to select it.
- **Size** — S / M / L / XL / XXL to scale the pet.
- **+ Import Pet** — Import a custom spritesheet (`.webp`, 8 columns × 11 rows).
- **Setup Wizard** — Re-run the tool detection wizard.
- **Quit** — Exit Agent Pets.

Click **‹** to return to the Sessions view.

---

## Setup Wizard / 設定精靈

The Setup Wizard detects installed tools and installs hooks automatically:

- **OpenCode CLI** — Adds event webhook to `~/.config/opencode/opencode.json`
- **OpenCode Desktop** — Adds event webhook to `~/Library/Application Support/opencode/config.json`
- **Codex CLI** — Creates `~/.codex/hooks.json` and enables hooks in `~/.codex/config.toml`
- **Codex Desktop** — Same as Codex CLI
- **Claude Code CLI & Desktop** — Adds a `hooks` block to `~/.claude/settings.json` (CLI and Desktop share this config, so one install covers both)

Each tool shows a status dot:

- 🟢 **Green** — Installed and configured
- 🔴 **Red** — Not detected

Click **Retry** if a tool was not detected but you believe it is installed.

---

## Custom Pets / 自訂寵物

### Spritesheet Format / 精靈圖格式

Custom pets use the same spritesheet format as built-in pets:

- **Format**: `.webp`
- **Grid**: 8 columns × 11 rows
- **Cell size**: 192 × 208 pixels

Each row represents a different state:

| Row | State |
|-----|-------|
| 0 | Idle |
| 5 | Error |
| 6 | Waiting |
| 7 | Thinking |
| 8 | Success |

### How to Import / 如何匯入

1. Open the control panel (click the pet).
2. Click **⚙** to go to Settings.
3. Click **+ Import Pet**.
4. Select a `.webp` spritesheet file.
5. The pet is added to your collection and automatically selected.

Custom pets are stored in `~/.desktop-pets/custom/`.

### How to Rename / 如何重新命名

1. Open the control panel (click the pet).
2. Click **⚙** to go to Settings.
3. Find the custom pet in the list.
4. Click the **✎** pencil icon next to the pet name.
5. Type the new name and press **Enter** (or click elsewhere to confirm).
6. Press **Esc** to cancel.

Built-in pets cannot be renamed.

---

## Event Server / 事件伺服器

Agent Pets runs a local HTTP server on `http://127.0.0.1:17373/v1/events` that receives status updates from hooks.

### POST /v1/events

```json
{
  "source": "codex",
  "sessionId": "sess_abc123",
  "state": "thinking",
  "project": "/Users/you/my-project"
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | yes | `opencode-cli`, `opencode-desktop`, `codex`, `codex-desktop`, `claude`, `claude-desktop` |
| `sessionId` | string | yes | Unique session identifier |
| `state` | string | yes | `idle`, `thinking`, `tool-running`, `waiting-permission`, `waiting-input`, `success`, `error` |
| `project` | string | no | Project path (basename shown in UI) |

---

## Security / 安全性

- **Local only** — Server listens on `127.0.0.1` only; no network access.
- **Body limit** — Requests are limited to 64 KB.
- **State whitelist** — Only valid states are accepted; unknown states are rejected.
- **Path sanitization** — Project paths are truncated to basename only; no full paths leak into the UI.

---

## Development / 開發

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/yourname/agent-pets.git
cd agent-pets
npm install
```

### Run in Dev Mode

```bash
npm run dev
```

### Build

```bash
npm run build
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

## Project Structure / 專案結構

```
agent-pets/
├── electron/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # IPC bridge
│   ├── event-server.ts      # HTTP event server
│   └── setup.ts             # Platform-aware paths & setup
├── integrations/
│   ├── install.mjs          # Hook installer
│   ├── agent-hook.mjs       # Shared hook script
│   └── codex-hooks.json     # Codex hook definitions
├── src/
│   ├── components/
│   │   ├── DesktopPet.vue   # Pet window (drag + click)
│   │   ├── PetAnimation.vue # Canvas spritesheet renderer
│   │   ├── StatusPanel.vue  # Unified control panel
│   │   └── SetupWizard.vue  # Tool detection wizard
│   ├── stores/
│   │   └── agentStore.ts    # Pinia store (sessions, pets, UI state)
│   └── types/
│       └── agent.ts         # TypeScript types
├── public/
│   └── pets/                # Built-in pet spritesheets
├── package.json
└── README.md
```

---

## License / 授權條款

MIT
