# Phase 8 — Per-project Pet：驗證後修正紀錄

本檔案是 [Phase 8 報告](phase-8-project-pet.md) 交付後、實機驗證發現的問題與修正，供下一階段接手前快速掌握目前狀態。所有項目已修正、測試通過（89/89）、`vue-tsc --noEmit` 乾淨。

> **第二輪修正（token 計算重構）見文末「## 第二輪：token 計算重構」章節。**

## 這次改了什麼

### 1. History 專案篩選失效 + Claude/Codex token 用量偏差（同一根因）

- **問題**：[electron/history.ts](../../electron/history.ts) 的 `getSummary` 套用專案篩選時，會把所有本機 token 用量記錄（`LocalUsageReader` 掃 `~/.claude`、`~/.codex` 得到的資料）整批排除——這些記錄一律寫在共用的 `pet_id='local-usage'` 桶子、`project_id` 永遠是空字串，跟專案路由完全脫鉤。切換專案篩選時 token 數字要嘛全部歸零、要嘛沒反應。
- **修正**：
  - [electron/local-usage.ts](../../electron/local-usage.ts) 新增專案歸屬：Claude Code 逐行 JSONL 本來就帶 `cwd`；Codex 的 `session_meta` 那行帶 `payload.cwd`，同檔案後續 `token_count` 事件沿用它。解析出的 `cwd` 丟給 `ProjectRoutingStore.resolvePath()` 轉成匿名 `projectId`。
  - [electron/history.ts](../../electron/history.ts) 的 `recordTokenUsage` 現在會把 `projectId` 寫回 `events`／`daily_stats`（同時修正既有 row 更新時忘記回填 `project_id`、導致重複計算的問題）。
  - `getSummary` 篩選專案時改成把本機用量桶也一併納入、依 `project_id` 過濾，而不是整批排除。
  - 新增測試：`tests/local-usage.test.mts`「attributes local Codex and Claude usage to the routed project via cwd」。

### 2. 「專案寵物」功能沒有開關

- **問題**：路由行為（切換寵物、XP／History 依專案隔離）永遠開著，沒有使用者可控的開關。
- **修正**：[electron/project-routing.ts](../../electron/project-routing.ts) 的 `metadata` 表新增 `enabled` 旗標（`isEnabled()` / `setEnabled()`），`resolvePath()` 停用時直接回傳 `null`——不只是隱藏 UI，是真的讓 main process 停止解析路徑、停止寫 DB。已記錄的專案與綁定不會被刪除，重新開啟即恢復。
  - IPC：`project-pets-get-enabled` / `project-pets-set-enabled`（[electron/main.ts](../../electron/main.ts)）
  - UI：[src/components/StatusPanel.vue](../../src/components/StatusPanel.vue) 「專案寵物」卡片最上方的 `ToggleRow`
  - 新增測試：`tests/project-routing.test.mts`「disabling routing suppresses new resolution but keeps stored bindings」、「the enabled flag persists across reopening the store」

### 3. `archiveProject()` 死代碼 → 接成「移除專案」功能

- **問題**：`ProjectRoutingStore.archiveProject()` 已實作但沒有任何 IPC handler 或 UI 呼叫它。
- **修正**：新增 IPC `project-pets-archive`、`preload.ts` / `agentStore.ts` 對應方法、專案清單每列加上移除按鈕（沿用既有 pet 移除的確認對話框樣式）。
  - 新增測試：`tests/project-routing.test.mts`「archiveProject removes a project from listProjects」

### 4. 事件熱路徑上的同步 I/O

- **問題**：`normalizeIngressEvent`（[electron/main.ts](../../electron/main.ts)）在**每一個** agent 事件（包含高頻的 `tool-running`／`thinking`）都做同步 `lstatSync`／`realpathSync` 加一次 SQLite UPSERT transaction；同一條路徑上 `availablePetIds()` 也是每次同步讀 `pets.json` + 掃自訂寵物資料夾。busy session 下可能卡住主行程 UI。
- **修正**：
  - `ProjectRoutingStore.resolvePath()` 加上以 raw path 字串為 key 的記憶體快取（上限 512 筆，簡單 FIFO 淘汰），重複路徑不再重新 stat 檔案系統。
  - 新增 `trackSeen()` 給即時事件用：identity 解析每次都做（走快取），但 SQLite 寫入（更新 `last_seen_at`）節流成同一專案最多 30 秒寫一次。`registerPath()`（使用者主動「加入專案」時呼叫）維持每次都寫，確保操作即時反映。
  - `availablePetIds()` 加上 5 秒記憶體快取，只用在事件熱路徑；使用者主動操作（挑選資料夾、綁定、列表）仍每次讀新資料。
  - 新增測試：`tests/project-routing.test.mts`「trackSeen resolves without hitting the filesystem twice and throttles the write」

### 5. UI 跑版

- **問題**：「啟用專案寵物」開關沒用 `ToggleRow` 自帶的 `help` 屬性（檔案裡其他所有開關都用），額外塞了一段 `<p>`，視覺上跟其他開關不一致；專案清單「名稱 + 下拉選單 + 移除鈕」那排在專案名稱較長時會撐爆，因為文字沒有省略號、旁邊控制項不會縮。
- **修正**：改用 `ToggleRow` 的 `:help`；`.field-label` / `.field-help` 加上 `text-overflow: ellipsis` + `title` 屬性；專案列的下拉選單最小寬度從 128px 收窄到 108px 讓長名稱有空間。

### 6. `v-model` 與顯式 listener 混用

- **問題**：History 專案篩選的 `<Select>` 同時寫 `v-model="historyProjectFilter"` 又寫 `@update:model-value="refreshHistory"`，是這個檔案裡唯一一處這樣寫的地方，行為依賴 Vue 對重複 listener 的合併順序，脆弱且與慣例不一致。
- **修正**：統一成跟檔案裡其他 Select 一樣的 `:model-value` + `@update:model-value` 手動綁定。

## Skill 更新

[.agents/skills/pet-skill/references/phase-gates.md](../../.agents/skills/pet-skill/references/phase-gates.md) 新增「Common gaps that trigger extra review rounds」章節，把上述 7 類問題整理成明確檢查項（共用聚合表漏加新維度、開關沒真的接 main process、熱路徑同步 I/O、動態列文字溢出、元件既有 prop 沒重用、`v-model` 跟顯式 listener 混用、死代碼沒接線），供下一階段實作前後自查。

## 驗證證據

- `pnpm exec vue-tsc --noEmit`：通過
- `pnpm run test:unit`：89/89 通過（含本次新增 5 個測試）
- 尚未在真實 Electron 視窗手動驗證新 UI（開關、移除按鈕、跑版修正）——**下一階段開始前建議先 `pnpm run dev` 肉眼確認一次**。
- macOS native runtime 仍未實測（延續 Phase 8 報告的既有殘留風險）。

## 版本

`package.json` 已由使用者手動由 `0.9.0` 升至 `0.10.0`（minor：本次改動涉及 routing store 的 schema/資料語意變化與新 public IPC 契約）。

## 後續可考慮但本輪未做

- `daily_stats`／`projects` 表目前沒有主動清理策略，`MAX_PROJECTS = 256` 只限制 `listProjects()` 回傳筆數，長期使用下資料表本身無上限。

## 第二輪：token 計算重構

使用者實測回報：「有些專案有在用，卻沒顯示正確數量，直接是 0」、「跟 Claude Code／Codex 官方顯示的用量對不起來」。追查後找到兩個根因，都已修正並補測試（新增 5 個測試，全部通過；`vue-tsc --noEmit` 乾淨）。

### 根因 1：本機用量掃描只「查詢」專案身份，沒有「登記」

[electron/local-usage.ts](../../electron/local-usage.ts) 掃描 Claude Code／Codex 本機 log 算出 token 用量後，過去只呼叫 `ProjectRoutingStore.resolvePath()`（唯讀）取得 `projectId` 附加在用量記錄上，從未把該專案寫進 `projects` 資料表。結果是：一個只有歷史 log、從未觸發過即時 hook 事件的專案，它的 token 用量其實已經正確算出並存好，但因為它從沒出現在 `projects` 表裡，「專案寵物」清單／History 篩選下拉選單永遠看不到它、選不到它——使用者只會看到「這個專案在用，但顯示 0」。

**修正**：`LocalUsageReader` 改呼叫 `ProjectRoutingStore.trackSeen()`（既有的、給即時事件用的方法，內建節流），讓本機 log 掃描跟即時事件走同一套解析＋登記邏輯，兩者永遠不會對同一個資料夾算出不同的 `projectId`，掃描到的專案也一定會出現在清單裡。

同時修正 `ProjectRoutingStore.resolvePath()` 的一個連帶問題：路徑解析結果的記憶體快取過去連「解析失敗（當下讀不到這個資料夾）」都會快取下來，之後即使資料夾恢復可讀，也會一直回傳失敗前的舊識別碼，無法自我修復。現在只快取「已透過檔案系統確認存在」的成功結果。

### 根因 2：Codex context 壓縮／resume 造成的計數暴衝

Codex 的 `total_token_usage` 是整個 session 的累計值。原本邏輯：只要新的累計值比上次記錄的小（代表 context 被壓縮或 resume 重置了計數器），就會把「整個新的（較小的）累計值」當成全新用量灌進去——等於在重置當下額外多算了一大筆並非真的新產生的 token，導致總量跟官方顯示的對不上、有時會看到數字突然暴衝。

**修正**：偵測到計數器往下掉時，不再把新值當全新用量，而是把這次新增用量記為 0、把基準值重新校正到新的累計值，之後的差值都改用新基準計算。這樣最多是「少算一小段」，不會再「灌入一大筆從沒真的發生過的用量」。

### 影響範圍

- `electron/local-usage.ts`、`electron/project-routing.ts`
- `tests/local-usage.test.mts`（新增：reset 不暴衝、只有歷史 log 的專案會被登記）、`tests/project-routing.test.mts`（沿用既有測試，無需改動）
- 外部介面沒變：`LocalUsageReaderOptions` 的 `projectRouting` 選項仍是同一個形狀（main.ts 傳入 `projectRoutingStore` 不用改），Achievements 的 `onRecordImported` 串接（若後續重新加回）不受影響。

### 尚未處理

- Claude Code 較新版本的 assistant 訊息可能帶有 `usage.iterations`（單一訊息內多次工具呼叫的逐步用量陣列）。本機實測的 94 個 transcript 檔案中沒有出現 `iterations.length > 1` 的案例，因此本輪未處理；如果之後在其他帳號／版本上看到用量偏低，這是第一個該查的地方。
- 大型持續成長的 session log 檔案，每次掃描仍會整檔重新讀取＋解析（只是靠 `recordTokenUsage` 的去重機制避免重複寫入，不是避免重複運算）。這是效能問題，不是正確性問題，暫不處理。
