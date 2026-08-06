# Agent Pets

顯示 AI 編程助手即時狀態的桌面寵物。

[English](README.md) | **繁體中文**

---

## 功能

- **即時狀態** — 一眼看出目前哪個助手正在執行、思考中還是閒置。
- **可拖曳寵物** — 拖到螢幕任意位置（重開 app 後位置會保留）。
- **多助手支援** — OpenCode、Codex、Claude Code（CLI 與 Desktop）。
- **自訂寵物** — 匯入自己的精靈圖，或是像 [codex-pets.net](https://codex-pets.net) 這類網站的 `.codex-pet.zip` 素材包。

---

## 支援的工具

| 工具 | CLI | Desktop |
|-------|-----|---------|
| OpenCode | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Claude Code | ✅ | ✅ |

---

## 快速開始

### 安裝（Windows）

從 [Releases](https://github.com/Ponpon55837/agent-pets/releases) 頁面下載並執行 `Agent Pets.exe`。不需要安裝——它是可攜式應用程式。

### 安裝（macOS）

下載 `Agent Pets.dmg`，打開後把 app 拖到「應用程式」資料夾。

### 第一次執行

1. 啟動 Agent Pets，螢幕上會出現一隻小寵物。
2. 點擊寵物，然後 **⚙ → Setup Wizard**。它會偵測你機器上安裝了哪些 AI 工具。
3. 點某個工具旁的 **Install**（或 **Install All**）來安裝對應的 hooks——精靈本身不會自動安裝，需要你手動點擊。
4. Hooks 安裝完後，重新啟動你的編程工具；寵物的外觀就會開始反映你的助手狀態。

---

## 使用方式

### 與寵物互動

| 動作 | 效果 |
|--------|--------|
| **左鍵點擊**寵物 | 打開控制面板（面板是獨立視窗，出現在寵物旁邊——寵物本身不會移動） |
| **拖曳**寵物 | 移動到新位置（重開 app 後會保留） |
| **右鍵點擊** | 沒有作用（已停用） |

寵物下方有一個浮動狀態列，最多顯示 **3 行**，每行對應一個目前活躍的工具家族（Codex / Claude / OpenCode）。同一工具的 CLI 跟 Desktop 版本會合併成一行顯示（例如 `Claude (CLI+Desktop) · Thinking`）。當沒有任何工具在跑時，會顯示一行寵物整體的 idle/offline 狀態。

### 控制面板

點擊寵物打開控制面板——一個獨立的、永遠置頂的視窗，有兩個畫面：

#### Sessions 畫面（預設）

顯示所有 session（包含剛離線不久的）目前的狀態：

- **Idle** — 助手正在等待輸入
- **Thinking** — 助手正在處理中
- **Tool Running** — 助手正在執行工具
- **Waiting Permission** — 助手正在等待你核准
- **Success** — 任務完成
- **Error** — 發生錯誤
- **Offline** — Session 已結束或逾時失聯

進行中的狀態（Thinking / Tool Running / Waiting）旁邊會顯示已耗時秒數。如果有離線的 session，列表下方會出現 **Clear offline** 按鈕，一鍵清除。

點標題列的 **⚙** 圖示切換到 Settings。

#### Settings 畫面

面板分成 **Settings** 與 **Pets** 兩個分頁。

**Settings 分頁**

- **Size** — S / M / L / XL / XXL 調整寵物大小。
- **Mood** — 任務成功會微幅上升、失敗會下降的心情值，純裝飾用途，心情好時寵物會帶一層暖色光暈、心情差時會稍微變暗——所有狀態都會套用，不是只有待機時。每天開始會自動重設回基準值，也可以點 **Reset** 手動重設（永遠是重設回基準值本身，不是加分，所以沒辦法靠一直點來刷高）。
- **Sound** — 成功/失敗/等待核准時的短音效（用 Web Audio 即時合成，不需要音檔）。**預設關閉。**
- **Bounce & shake** — 點擊/狀態切換時的彈跳、閒置搖擺、waiting-permission 抖動。**預設關閉。**
- **Bubble** — 完成提示氣泡跟寵物上方「正在做什麼」的活動氣泡。**預設關閉。**
- **Setup Wizard** — 重新偵測工具，或安裝/重新安裝 hooks。
- **Restart Pet** — 寵物或動畫卡住時，完整重新啟動 Agent Pets。
- **Quit** — 結束 Agent Pets。

**Pets 分頁**

- **Pet** — 選擇要顯示哪隻寵物，點名字即可切換。
- **+ Import Sprite** — 匯入自訂精靈圖（`.webp`/`.png`/`.jpg`，8 欄 × 11 列）。
- **+ Import .zip** — 一鍵匯入 `.codex-pet.zip` 素材包（例如從 codex-pets.net 下載的），不用手動解壓縮。
- **Multi-pet** — 同時有 2 個以上工具家族在跑時，改成每個家族各顯示一隻小寵物，而不是只顯示優先權最高的那隻。**預設關閉。** 開啟後，每個工具的寵物選擇也會顯示在這個分頁。

點 **‹** 回到 Sessions 畫面。

---

## Setup Wizard（設定精靈）

Setup Wizard 會偵測每個工具的設定狀態，並在你點擊按鈕時才安裝對應的 hooks——它本身不會自動安裝任何東西：

- **OpenCode CLI / Desktop** — 寫入 plugin 到 `~/.config/opencode/plugin/`（注意：是單數 `plugin`，跟 OpenCode 實際掃描的目錄一致）以及對應平台的 OpenCode Desktop plugin 目錄
- **Codex CLI** — 建立 `~/.codex/hooks.json` 並在 `~/.codex/config.toml` 啟用 hooks
- **Claude Code CLI & Desktop** — 在 `~/.claude/settings.json` 加入 `hooks` 區塊（CLI 跟 Desktop 共用這份設定，所以裝一次兩邊都算；實際是哪一邊觸發的事件，是透過 Claude Code 的 `CLAUDE_CODE_ENTRYPOINT` 環境變數在執行當下判斷，不是安裝程式決定的）

每個工具會顯示一個狀態燈：

- 🟢 **綠燈** — 已安裝且設定完成
- 🟡 **黃燈** — 有偵測到，但還沒（完全）設定好
- 🔴 **紅燈** — 沒偵測到

點工具旁的 **Install** 可以單獨（重新）安裝該項整合，或點 **Install All** 一次全部裝好。如果某個工具的狀態看起來過期了，點 **Refresh** 重新偵測。

> 註：目前沒有獨立的「Codex Desktop」hook 安裝項目——只有 Codex CLI 的 hooks 有接上。

---

## 自訂寵物

### 精靈圖格式

自訂寵物使用跟內建寵物相同的精靈圖格式：

- **格式**：`.webp`、`.png` 或 `.jpg`（內建寵物是用 `.webp` 出貨；三種格式匯入後都是原樣複製，讀取時是看內容而不是看副檔名）
- **網格**：8 欄 × 11 列（目前只用到第 0–8 列；9、10 保留給未來的狀態用）
- **格子大小**：192 × 208 像素

每一列對應一種狀態：

| 列 | 狀態 |
|-----|-------|
| 0 | Idle / Offline |
| 5 | Error |
| 6 | Waiting Permission / Waiting Input |
| 7 | Thinking / Tool Running |
| 8 | Success |

### 如何匯入

**匯入單張精靈圖：**

1. 打開控制面板（點擊寵物）。
2. 點 **⚙** 進入 Settings。
3. 點 **+ Import Sprite**。
4. 選擇一張 `.webp`/`.png`/`.jpg` 精靈圖檔案。
5. 寵物會加入你的收藏並自動被選取。

**從 `.codex-pet.zip` 素材包匯入**（例如從 [codex-pets.net](https://codex-pets.net) 下載的）：

1. 打開控制面板 → **⚙** → Settings。
2. 點 **+ Import .zip**，選擇下載好的 `.zip`。
3. App 會自動讀取裡面的 `pet.json` 跟精靈圖——不用手動解壓縮。

自訂寵物存放在 `~/.desktop-pet/custom/`。

### 如何重新命名

1. 打開控制面板（點擊寵物）。
2. 點 **⚙** 進入 Settings。
3. 在清單中找到該自訂寵物。
4. 點寵物名字旁的 **✎** 鉛筆圖示。
5. 輸入新名字後按 **Enter**（或點其他地方確認）。
6. 按 **Esc** 取消。

內建寵物無法重新命名。

### 如何移除／隱藏

點清單中任一寵物旁的 **×** 即可移除（會先跳出確認提示，避免手滑誤觸）——自訂寵物會直接刪除匯入的檔案；內建寵物則只是從你自己的清單隱藏（不會動到隨 app 出貨的素材檔案本身）。預設的保底寵物（`aang-airbender`）沒有 **×**，無法被移除或隱藏，確保清單裡永遠至少有一隻寵物可用。

---

## 事件伺服器

Agent Pets 會在本機啟動一個 HTTP 伺服器 `http://127.0.0.1:17373/v1/events`，接收來自各 hooks 的狀態更新。

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

`source`、`sessionId`、`state`、`timestamp` 這四個欄位是必填的——缺任何一個都會被伺服器回 `400` 拒絕。

**欄位說明：**

| 欄位 | 型別 | 必填 | 說明 |
|-------|------|----------|-------------|
| `source` | string | 是 | `opencode-cli`、`opencode-desktop`、`codex`、`codex-desktop`、`claude`、`claude-desktop`（也接受 `opencode`，會自動正規化成 `opencode-cli`） |
| `sessionId` | string | 是 | 唯一的 session 識別碼（最長 256 字元） |
| `state` | string | 是 | `idle`、`thinking`、`tool-running`、`waiting-permission`、`waiting-input`、`success`、`error`、`offline`（也接受 `waiting`，會自動正規化成 `waiting-permission`） |
| `timestamp` | number | 是 | 事件發生時間的 Unix 毫秒時間戳 |
| `project` | string | 否 | 專案路徑（UI 只會顯示 basename） |
| `originalEvent` | string | 否 | 觸發這筆事件的原始 hook/事件名稱，方便除錯 |
| `toolName` | string | 否 | 工具名稱，`tool-running` 時會顯示在活動氣泡裡 |

---

## 安全性

- **僅限本機** — 伺服器只監聽 `127.0.0.1`，不對外網開放。
- **請求大小限制** — 單一請求限制 64 KB。
- **狀態白名單** — 只接受合法的狀態值，未知狀態一律拒絕。
- **路徑清理** — 專案路徑只會保留 basename，完整路徑不會外洩到 UI。

---

## 開發

### 前置需求

- Node.js 18+
- pnpm 11+

### 環境設置

```bash
git clone https://github.com/Ponpon55837/agent-pets.git
cd agent-pets
pnpm install
```

### 開發模式執行

```bash
pnpm dev
```

### 建置

```bash
pnpm build
```

輸出會在 `release/` 目錄下。

### 安裝 Hooks（開發用）

```bash
node integrations/install.mjs
```

這會幫所有偵測到的工具安裝 hooks，安裝位置為：

- `~/.codex/hooks.json`（Codex）
- `~/.claude/settings.json`（Claude Code CLI & Desktop）
- `~/.desktop-pet/agent-hook.mjs` + `agent-hook.cmd`（上述所有工具共用的 hook script）

用 `--claude-code` 可以只安裝/移除 Claude Code 的 hook：

```bash
node integrations/install.mjs --claude-code
node integrations/install.mjs --uninstall --claude-code
```

---

## 專案結構

```
agent-pets/
├── electron/
│   ├── main.ts              # Electron 主行程
│   ├── preload.ts           # IPC 橋接
│   ├── event-server.ts      # HTTP 事件伺服器
│   └── setup.ts             # 跨平台路徑與安裝邏輯
├── integrations/
│   ├── install.mjs          # 獨立的 CLI hook 安裝程式
│   ├── agent-hook.mjs       # 共用的 hook script（透過 extraResources 打包進 app）
│   └── agent-hook.cmd       # agent-hook.mjs 的 Windows 包裝腳本
├── src/
│   ├── components/
│   │   ├── DesktopPet.vue   # 寵物視窗（拖曳＋點擊）
│   │   ├── PetAnimation.vue # Canvas 精靈圖渲染
│   │   ├── StatusPanel.vue  # 統一控制面板
│   │   └── SetupWizard.vue  # 工具偵測＋安裝精靈
│   ├── stores/
│   │   └── agentStore.ts    # Pinia store（sessions、寵物、UI 狀態）
│   ├── types/
│   │   └── agent.ts         # TypeScript 型別
│   └── utils/
│       ├── format.ts        # 共用格式化函式
│       └── sound.ts         # 即時合成音效（Web Audio API）
├── public/
│   └── pets/
│       ├── pets.json        # 內建寵物清單（id/displayName/folder）
│       └── <pet-id>/        # 每隻內建寵物的 spritesheet.webp + pet.json
├── package.json
└── README.md
```

App 本身的安裝/解除安裝邏輯（Setup Wizard 按鈕在用的那套）在 `electron/setup.ts` 裡、直接在 app 行程內執行；`integrations/install.mjs` 是給終端機執行的獨立對應版本（見上方〈安裝 Hooks（開發用）〉），兩邊產生的 hook script 跟 plugin 內容是一樣的，但需要手動同步維護。

---

## 授權條款

MIT — 詳見 [LICENSE](LICENSE)。
