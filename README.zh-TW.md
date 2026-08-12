# Agent Pets

顯示 AI 編程助手即時狀態的桌面寵物。

[English](README.md) | **繁體中文**

---

## 功能

- **即時狀態** — 一眼看出目前哪個助手正在執行、思考中還是閒置。
- **可拖曳寵物** — 拖到螢幕任意位置（重開 app 後位置會保留）。
- **多助手支援** — OpenCode、Codex、Claude Code（CLI 與 Desktop）。
- **自訂寵物** — 匯入自己的精靈圖，或是像 [codex-pets.net](https://codex-pets.net) 這類網站的 `.codex-pet.zip` 素材包。
- **桌面控制** — 系統匣選單、原生等待／完成通知、勿擾模式、音效控制，以及可選的登入時啟動。
- **Mini／Edge 模式** — Mini 可隨時切換；Edge Peek 需由使用者在 Settings 或 Tray 開啟，拖到螢幕邊緣停留片刻會顯示專用 Liquid Glass handle，不會裁切寵物本體，且會依螢幕與 DPI 變更重新定位。
- **權限控制** — OpenCode 的 permission request 可直接在 Liquid Glass 寵物氣泡選擇只允許一次或拒絕；只有符合條件且顯示中的請求才會註冊全域快捷鍵。
- **寵物成長** — 完成 session、受上限保護的觀察到的工作時間、每日首次完成與連續天數會產生持久 XP；Level 與 Evolution 由主行程 SQLite ledger 保存，重開後仍會恢復。

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

系統匣選單可以顯示／隱藏寵物、開啟面板或 Settings、切換 Mini／Edge Peek 模式／勿擾模式／音效／通知、在打包版本設定登入時啟動、以系統匣圖示標示待處理狀態，以及結束 app。關閉或隱藏寵物視窗後，hooks 與背景狀態仍會運作，直到選擇 **Quit**。

寵物下方有一個浮動狀態列，最多顯示 **3 行**，每行對應一個目前活躍的工具家族（Codex / Claude / OpenCode）。同一工具的 CLI 跟 Desktop 版本會合併成一行顯示（例如 `Claude (CLI+Desktop) · Thinking`）。當沒有任何工具在跑時，會顯示一行寵物整體的 idle/offline 狀態。

### 控制面板

點擊寵物打開控制面板——一個獨立的、永遠置頂的視窗，有兩個畫面；主畫面包含 **Sessions** 與 **Usage** 分頁：

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

#### Usage 分頁

顯示 Codex 與 Claude Code 回報的訂閱剩餘用量，包含 session／weekly 額度、重置倒數，以及依使用者本地時區顯示的重置日期時間。Codex／Claude family 活動時，既有寵物狀態 pill 底部會內嵌一條 3px 額度條，不改變視窗高度；它會優先顯示短期 session，若供應商只回傳 weekly 則自動改用 weekly。將滑鼠移到狀態列即可查看百分比與完整重置時間。**Agent Pets 沒有帳號系統，也永遠不會要求輸入 Agent 帳號、密碼或 token。** 它只沿用 Codex CLI／Claude Code 原本已建立的本機訂閱 session，由 Electron 主行程向供應商的 quota API 查詢，UI 只會收到整理過的百分比。若該 CLI session 不存在或已失效，重新驗證會在原本的 CLI 內進行，不是在 Agent Pets。結果會快取一分鐘；相關 Agent 活動期間，細條每五分鐘更新一次，按 **Refresh** 則會立即為兩個視窗取得新資料。只使用 API key 的 Codex session 無法取得訂閱額度。

點標題列的 **⚙** 圖示切換到 Settings。

#### Settings 畫面

面板使用可擴充的分區導覽：**Appearance**、**Desktop**、**Pets**、**Growth** 與 **Advanced**。

**Appearance 分區**

- **Size** — S / M / L / XL / XXL 調整寵物大小。
- **Bounce & shake** — 點擊／狀態切換時的彈跳、閒置搖擺、waiting-permission 抖動。**預設關閉。**
- **Status bubble** — 一般成功／錯誤提示約 3 秒後自動關閉，並以進度條顯示剩餘時間；權限請求絕不會自動關閉。**預設關閉。**

**Desktop 分區**

- **Mini mode** — 將寵物縮成 96px 左右的小型視圖，隨時可恢復 Normal。
- **Edge peek** — 獨立選項，**預設關閉**。開啟後拖到任一螢幕邊緣停留約 650ms，會顯示專用 42px 厚、96px 長的 Liquid Glass handle；按下或 hover 會展開回 Normal，不會留下寵物裁切區塊。待處理的權限請求會自動恢復完整可操作視圖。
- **Do Not Disturb** — 勿擾模式會抑制原生通知、寵物音效、額外動態效果與非必要氣泡，但不會停止事件接收。**預設關閉。**
- **Notifications** — 等待核准、等待輸入、完成與錯誤的原生通知；同 session 的重複事件有冷卻時間，結束事件會批次合併。**預設開啟。**
- **Sound** — 成功/失敗/等待核准時的短音效（用 Web Audio 即時合成，不需要音檔）。**預設關閉。**
- **Launch at startup** — 登入系統時啟動 Agent Pets；此開關只在打包版本可用。
- **顯示權限泡泡** — 與一般 Bubble 分開的 Liquid Glass 權限卡片開關。關閉只會隱藏 Allow once／Deny 卡片，不會允許或拒絕請求；待處理請求仍由 Broker 保留、繼續顯示在系統匣徽章，並可由 Agent 或終端機處理。**預設開啟。**

**Advanced 分區**
- **Setup Wizard** — 重新偵測工具，或安裝/重新安裝 hooks。
- **Restart Pet** — 寵物或動畫卡住時，完整重新啟動 Agent Pets。
- **Quit** — 結束 Agent Pets。

**Growth 分頁**

- **Mood** — 每天從低基準 10 開始；任務成功 +4、失敗 -6。長任務每完成 2 個工具會再 +1（每個任務最多 +8），每持續工作 5 分鐘也會 +1（每個任務最多 +4），因此完成獎勵之前的進度分數最多 +12。心情成長時，會以目前寵物影格生成貼合自身輪廓的動態能量層，並在 90 以上進入完整爆氣效果。點 **Reset** 只會回到 10，不會額外加分。
- **Mood visuals** — 可關閉 mood 對寵物 aura、色彩與能量層的視覺影響；數值仍會持續追蹤，之後重新開啟即可恢復。
- **XP／Level** — Growth chip 會顯示目前選取寵物的持久 XP、Level、Evolution 階段與目前 streak。XP 使用有版本的去重 ledger：每個 canonical session 完成 +20、每日首次完成 +10、每觀察到 30 分鐘 active coding +2（每個 session 最多 +10），延續前一天 streak +5。失敗或取消不會扣永久 XP；token milestone 等待精確 token event contract。

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

設定完成的整合可以點 **Test**，透過目前 app 的本機 HTTP 接收器送出一筆短暫事件。測試通過代表這個 Agent Pets 實例確實收到並顯示了事件；它不會啟動編程工具，也不代表該工具本身已主動觸發 hook。

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

Agent Pets 會在本機啟動一個 HTTP 伺服器 `http://127.0.0.1:17373/v1/events`，接收來自各 hooks 的狀態更新。請求必須包含每次安裝專用的 `X-Agent-Pets-Token` header；受管理的 hooks 會自動從目前使用者專用、權限受限的 `~/.desktop-pet/event-token` 讀取。

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

`source`、`sessionId`、`state`、`timestamp` 這四個欄位是必填的——缺任何一個都會被伺服器回 `400` 拒絕；缺少或使用錯誤的 hook 驗證資訊則回 `401`。

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

- **Renderer 隔離** — Renderer 啟用 Chromium sandbox 與 context isolation、停用 Node.js integration，使用安全的自訂 `agent-pets://` protocol 取代高權限 `file://` 頁面，並以嚴格 CSP、禁止彈窗／外部導頁、拒絕權限請求及 IPC 主 frame 來源驗證縮小攻擊面。
- **本機事件伺服器** — 只監聽 `127.0.0.1`，每個 hook 請求都必須通過每次安裝專用 secret 驗證；同時拒絕瀏覽器來源與非 JSON 請求、限制事件速率，且只接受長度受限的白名單欄位。
- **用量查詢** — Quota 功能只允許連線到指定的 Codex 與 Anthropic HTTPS quota／驗證端點，拒絕轉址、過大回應、過多 window 與格式錯誤的 renderer IPC payload。OAuth 憑證只存在 Electron 主行程，不會傳給 renderer 或出現在命令列參數。
- **憑證更新** — OAuth token 過期時會更新，並安全合併回原本的 Codex auth 檔或 Claude 憑證儲存區，避免 CLI 登入失效；檔案寫入會做帳號／變更檢查、限制檔案權限，並盡可能採原子替換。
- **寵物匯入** — 寫入前會驗證 ZIP 項目數、壓縮／解壓縮大小、JSON 大小，以及圖片大小與實際格式。
- **記憶體上限** — Agent session 數量有上限，會優先淘汰離線／最舊項目，避免 renderer 記憶體無限成長。
- **路徑清理** — 專案路徑只保留 basename，檔案寫入目的地也會限制在預期根目錄內。
- **桌面通知** — 通知只會使用正規化後的 Agent 名稱與長度受限的專案 basename，不會顯示或記錄 prompt、工具參數、session identifier 或憑證；診斷紀錄有固定上限，而且只保存事件類別與結果。
- **桌面偏好 IPC** — 系統匣／勿擾／通知／權限泡泡／登入啟動偏好由 main process 擁有。Renderer 只能從已驗證的第一方 frame 傳送白名單 boolean 欄位，設定檔採長度受限讀取與原子替換。
- **Permission Broker** — 權限回覆使用獨立 loopback port 與專用的每次安裝 token，不會經過一般事件端點。Main process 強制 TTL、一次性狀態轉換、anti-replay、資料上限、Adapter-owned opaque handle、限時快捷鍵、Agent 端解決對帳，以及內容去識別且有上限的本機 audit；只提供 `allow_once` 與 `deny`，刻意不提供永久允許。
- **Progression 儲存** — XP 只在 Electron 主行程發放。SQLite migration、同一 transaction 的 `pet_progress`／`xp_ledger` 更新、唯一 idempotency key、受上限保護的 session active-time 與 sanitized snapshot，避免 renderer 或重送事件灌高 XP。資料庫只留在本機，不會上傳。
- **打包執行環境** — Electron fuses 會停用 RunAsNode、Node options／inspect 參數與 `file://` 額外權限，並強制只從 ASAR 載入及驗證內嵌 ASAR 完整性。
- **發行簽章** — 正式發布 macOS／Windows 產物時必須配置平台簽章憑證；未簽章的本機建置只供開發測試。

---

## 開發

### 前置需求

- Node.js 22.12+
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

### 單元測試

```bash
pnpm test:unit
```

### 安裝 Hooks（開發用）

```bash
node integrations/install.mjs
```

這會幫所有偵測到的工具安裝 hooks，安裝位置為：

- `~/.codex/hooks.json`（Codex）
- `~/.claude/settings.json`（Claude Code CLI & Desktop）
- `~/.desktop-pet/agent-hook.mjs` + `agent-hook.cmd`（上述所有工具共用的 hook script）
- `~/.desktop-pet/event-token`（每次安裝專用的事件驗證 secret；macOS／Linux 權限為 `0600`）

既有安裝升級後，Agent Pets 會自動更新受管理的 hooks。已經在執行中的 OpenCode 需要重新啟動一次，讓已載入的 plugin 套用事件驗證。

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
│   ├── event-normalizer.ts  # 一般事件 allowlist 與 projection
│   ├── permission-broker.ts # 權限狀態機與 anti-replay
│   ├── permission-adapter-server.ts # 獨立的 OpenCode 回覆通道
│   ├── permission-audit.ts  # 有上限且去敏感內容的本機 audit
│   ├── progression.ts       # SQLite XP ledger 與 Level projection
│   ├── pet-window-mode.ts   # Mini／Edge 幾何與 dwell 常數
│   ├── desktop-preferences.ts # Main 擁有的桌面偏好
│   ├── desktop-notifications.ts # 原生通知與有上限的診斷紀錄
│   ├── desktop-tray.ts      # 系統匣生命週期與選單
│   ├── notification-policy.ts # 純通知分類／冷卻規則
│   ├── quota.ts             # Codex／Claude 剩餘用量讀取
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
│   │   ├── agent.ts         # Agent 事件型別
│   │   └── desktop.ts       # 桌面偏好 IPC 型別
│   └── utils/
│       ├── format.ts        # 共用格式化函式
│       └── sound.ts         # 即時合成音效（Web Audio API）
├── public/
│   └── pets/
│       ├── pets.json        # 內建寵物清單（id/displayName/folder）
│       └── <pet-id>/        # 每隻內建寵物的 spritesheet.webp + pet.json
├── tests/                   # Node 內建單元測試
├── package.json
└── README.md
```

App 本身的安裝/解除安裝邏輯（Setup Wizard 按鈕在用的那套）在 `electron/setup.ts` 裡、直接在 app 行程內執行；`integrations/install.mjs` 是給終端機執行的獨立對應版本（見上方〈安裝 Hooks（開發用）〉），兩邊產生的 hook script 跟 plugin 內容是一樣的，但需要手動同步維護。

---

## 授權條款

MIT — 詳見 [LICENSE](LICENSE)。用量整合以 MIT 授權的 [TokenBar](https://github.com/Nanako0129/TokenBar) 為基礎，詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
