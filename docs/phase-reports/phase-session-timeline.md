# Phase C：工作階段清單與時間軸（只含中繼資料）

- 日期：2026-11-08
- 分支：`feat/session-timeline`（自 `origin/main` `b49813b`，版本 `1.10.4`）
- 本 phase 未修改版本
- 建議版本：**patch**（以 1.11.1 發佈）。說明見文末。

## 範圍

1. **工作階段清單 API**：新 IPC `history-sessions`（唯讀、驗證寄件者），回傳過去工作階段的分頁清單：Agent／adapter、專案（已註冊專案用顯示名稱，否則只用資料夾名稱）、開始／最後活動／結束時間、時長、活躍時間、結果（完成／失敗／已取消／進行中／未完成）、工具執行次數、權限等待次數與時間、Token（新輸入／輸出／快取）、主要模型。依最後活動時間由新到舊的 keyset（cursor）分頁，每頁預設 30、上限 50。篩選：專案、Agent、日期範圍（沿用 7／30／90 天＋自訂日期）、結果、只搜尋專案名稱與 Agent。
2. **單一工作階段明細**：新 IPC `history-session-detail`，回傳該工作階段最近 500 筆狀態轉換（thinking → tool-running(工具名稱) → waiting-permission → success…）與 `truncated` 旗標。只有工具名稱，沒有參數。
3. **UI**：歷史分頁加上「總覽／工作階段」切換（`Tabs` pill + `TabPanel`）。工作階段清單（`HistorySessions.vue`）支援搜尋、Agent／結果篩選、自訂日期、「載入更多」、空狀態與錯誤重試；點選列開啟時間軸對話框（`HistorySessionDetail.vue`，沿用 `Dialog`）。
4. **匯出**：JSON 匯出新增 `sessions`（最多 1000 筆）與 `sessionsTruncated`，**專案名稱一律清空**（沿用既有「匯出不含專案名稱」的契約與測試）。CSV 匯出維持每日彙總、不變。
5. **README.md／README.zh-TW.md**：各新增一段「歷史 → 工作階段」說明；`project-map.md` 同步。

不在範圍內：提示詞、對話內容、工具參數、完整路徑；以及 pet 以外的跨寵物彙整（清單與總覽一樣以目前寵物為範圍）。

## 實作摘要

### 資料模型（schema v9，`electron/history.ts`）

- `sessions` 新增欄位：`project_label`（只存最後一段資料夾名稱）、`usage_key`（與本機紀錄 Token 對應的雜湊鍵）、`final_state`（`success|error|cancelled|open`）、`last_tool`、`tool_runs`、`permission_waits`、`permission_wait_ms`、`state_since`、`timeline_tracked`、`timeline_count`。
- 新表 `session_timeline(session_pk, seq, occurred_at, state, tool_name)`，`PRIMARY KEY(session_pk, seq) WITHOUT ROWID`。
- 新表 `session_model_usage(usage_key, model, last_at, token_*)`，`UNIQUE(usage_key, model)`，加 `last_at` 索引供保留期限清理。
- 新索引：`idx_history_sessions_pet_seen(pet_id, last_seen_at, session_pk)`、`idx_history_sessions_pet_project_seen(pet_id, project_id, last_seen_at, session_pk)`、`idx_history_sessions_pet_final_seen(pet_id, final_state, last_seen_at, session_pk)`。

### 寫入路徑（增量，不重掃事件）

- `recordEvent` 本來就會 `SELECT` 一次 session 列並 `UPDATE`；計數器在同一次 `UPDATE` 內更新，**沒有新增讀取**。
- 只有「狀態改變」或「執行中的工具換了」才 `INSERT` 一筆時間軸（主鍵插入 O(log n)）。重複狀態的 heartbeat 不寫時間軸。
- 每個工作階段最多保存 500 筆：超過時以主鍵點刪最舊一筆（每次 append 最多一次 O(log n) 刪除），所以儲存量是 O(工作階段數 × 500) 的硬上限。
- 權限等待時間：離開 `waiting-permission` 時加上 `occurredAt - state_since`，單次上限 6 小時（避免睡眠／關機造成離譜值）。
- 修正一個既有陷阱：`readSession().lastState` 會把 `waiting-*` 折成 `idle`（給活躍時間規則用），因此新增 `rawLastState` 判斷轉換，不改動原本活躍時間的語意。
- 本機紀錄 Token：本機事件列的 `session_id` 本來就是 `digest(adapter:agent:rawSessionId)`。hook 工作階段建立時以 adapter→本機讀取器 agent 的對照（`claude-code→claude`、`codex→codex`）算出相同的 `usage_key`，不保存原始 session id。`applyTokenUsage` 新增／重新掃描修正時以差量更新 `session_model_usage`，大量匯入時在記憶體合併、批次結束一次寫入（與 `daily_model_stats` 同模式）。

### 讀取路徑

- 查詢參數在 IPC 與 `HistoryStore` 各驗證一次（`normalizeSessionQuery`）：未知欄位丟棄；`projectId` 必須是 32 位 hex、`adapterId` 白名單字元且 ≤ 64、`outcome` 列舉、`search` 去除控制字元並截到 64 字、`from/to` 為有限整數且不超過「現在＋1 天」、`limit` 1–50 的整數、cursor 的 id 必須符合 session id 格式。所有值都綁定參數；SQL 只會由固定子句組合，LIKE 的 `%`、`_`、`\` 以 `ESCAPE '\'` 跳脫。
- 分頁 SQL 依篩選選擇索引（`INDEXED BY`）：有專案 → `pet_project_seen`；有結果 → `pet_final_seen`；其餘 → `pet_seen`。排序 `ORDER BY last_seen_at DESC, session_pk DESC` 由索引直接提供，cursor 用 row value `(last_seen_at, session_pk) < (?, ?)`；每頁只讀 `limit + 1` 列（多一列判斷是否有下一頁）。
- 一頁的 Token／主要模型以**一次** `WHERE usage_key IN (SELECT value FROM json_each(?))` 查詢取得（沒有 N+1），在 JS 單次走訪合併。SQL 字串來自有限組合，所以 statement cache 維持有界。
- 明細：`SELECT … FROM session_timeline WHERE session_pk = ? ORDER BY seq DESC LIMIT 500` 走主鍵，再反轉成舊→新；最舊一筆 `seq > 0` 即 `truncated`。

### 演算法與複雜度

| 操作 | 作法 | 複雜度 |
| --- | --- | --- |
| 每個 hook 事件 | 既有 1 讀 1 寫＋僅在轉換時 1 次主鍵插入（必要時 1 次主鍵刪除） | O(log n)；heartbeat 無額外寫入 |
| 本機 Token 匯入 N 筆 | 記憶體合併後每個 (usage_key, model) 一次 upsert | O(N + K log n) |
| 清單一頁 | 索引範圍掃描＋LIMIT，無排序；Token 一次 IN 查詢 | O(log n + p)，p ≤ 51 |
| 搜尋（LIKE %x%） | 同索引順序掃描，對專案名稱／Agent 做殘餘過濾 | 最壞 O(該寵物保留期內的工作階段數)，見殘餘風險 |
| 明細 | 主鍵範圍＋LIMIT 500 | O(log n + 500) |
| 匯出 | keyset 分頁走訪，最多 1000 筆 | O(1000) |
| 保留期限清理 | 依 `last_seen_at` 索引挑最舊 `limit` 個工作階段，一併刪除其時間軸；`session_model_usage` 依 `last_at` 索引分批刪除 | 每批有界 |
| Renderer 清單 | `shallowRef` 整批替換／附加；列加 `content-visibility: auto` 讓畫面外的列不排版、不繪製 | 渲染成本與可見列數成正比 |

### UI 與 Liquid Glass

- 清單列是內容層：平面 `--surface-raised`，沒有 `backdrop-filter`；只有既有的 `Dialog` scrim 屬於功能層，沒有玻璃疊玻璃。
- 長專案名稱、工具名稱、模型名稱：`min-width: 0` ＋ `text-overflow: ellipsis`，並以 `title` 提供完整文字。實測 70 字元專案名稱與 `mcp__filesystem__read_multiple_files_with_a_long_name` 皆正確截斷。
- 鍵盤：列是原生 `<button>`；`content-visibility` 會把繪製限制在列內，所以焦點框改為內縮（`outline-offset` 為負值），並以較高權重覆蓋面板全域 `:focus-visible`。對話框沿用 `useDialogA11y`（Esc、Tab 循環、焦點還原）。
- 狀態不只靠顏色：結果徽章有文字；時間軸標記以形狀區分（等待／錯誤為方形）並附狀態文字。狀態名稱沿用 `STATE_LABELS`（依專案慣例不翻譯）。
- `prefers-reduced-motion`：列的 hover 轉場關閉。淺色、深色都已實際截圖檢查。
- 文案：`growth` domain 新增 48 個 key，zh-TW／en-US 同步。
- `StatusPanelHistory.vue` 因 500 行上限測試，把原有 scoped CSS 原樣搬到 `StatusPanelHistory.css`（`<style scoped src>`，行為不變）。`Input.vue` 的 `type` 聯集新增 `'date'`（向下相容）。

## 遷移說明（v9）

- 完全加法式：`ALTER TABLE ADD COLUMN`（逐欄檢查 `PRAGMA table_info`）、`CREATE TABLE/INDEX IF NOT EXISTS`；`ensureSessionTimelineSchema()` 每次開啟都會跑，所以 marker 遺失或半套用的資料庫也能自我修復。
- v9 一次性回填（在單一交易內）：
  - `final_state` 由 `terminal_state`／`last_state` 推得；
  - `usage_key`：對 `events` 中不同的 hook 身分（`SELECT DISTINCT adapter_id, agent_id, session_id, project_id`）計算 session pk 與鍵，逐筆以主鍵 `UPDATE`；
  - `session_model_usage`：以一條集合式 `INSERT … SELECT … GROUP BY session_id, token_model` 從本機 Token 事件重建。
- **無法回填**：升級前的工具次數、權限等待與時間軸（heartbeat 先前已被合併成 rollup 列，無從還原）。這些工作階段 `timeline_tracked = 0`，UI 顯示「升級前的紀錄，無工具統計」並以「—」表示未知；升級後同一工作階段的新狀態仍會寫入時間軸，並標示為部分紀錄。
- 舊版程式開啟 v9 資料庫：新增欄位都有預設值，舊的 `INSERT` 不會失敗；舊版不會維護新欄位，再升級回來時那段期間的計數會少算（只影響顯示）。
- 測試以 `DROP COLUMN`／`DROP TABLE` 把資料庫還原成 v8 形狀後重開，驗證回填結果與重複開啟的冪等性。

## 驗證證據

- `pnpm exec vue-tsc --noEmit`：通過。
- `pnpm test:unit`：見交接報告中的數字（新增 `tests/history-sessions.test.mts` 11 個測試、`tests/ipc-history.test.mts` 新增 2 個）。
- `pnpm lint`、`pnpm exec vite build`、`check:bundle-size`、`check:bundle`、`check:contrast`、`check:design:strict`、`git diff --check`：通過。`check:design` 的 `rawControls` 資訊值 10 → 11（新增的清單列 `<button>`；`Button.vue` 不適合兩行內容的列，與既有 `SessionRow` 做法一致）。
- EXPLAIN QUERY PLAN（測試中斷言，且不得出現 `TEMP B-TREE`）：
  - 無篩選：`SEARCH sessions USING INDEX idx_history_sessions_pet_seen (pet_id=?)`
  - 專案＋cursor：`SEARCH sessions USING INDEX idx_history_sessions_pet_project_seen (pet_id=? AND project_id=? AND (last_seen_at,session_pk)<(?,?))`
  - 結果＝進行中：`SEARCH sessions USING INDEX idx_history_sessions_pet_final_seen (pet_id=? AND final_state=? AND last_seen_at>?)`
  - 時間軸：`SEARCH session_timeline USING PRIMARY KEY`；Token：`SEARCH session_model_usage USING COVERING INDEX sqlite_autoindex_session_model_usage_1`
- 寫入成本微基準（暫存目錄、單一交易內 20k 個 hook 事件、2000 個既有工作階段，機器負載高、數字浮動大）：不含新索引 4.35–5.04 秒、含新索引 4.52–6.36 秒，平均約 +14%，落在多次執行的變異範圍內；每個事件約 0.25 ms。
- 實際 Electron 驗證：`node scripts/e2e-isolated-electron.mjs`（暫時 HOME／userData、假 safeStorage，不碰鑰匙圈），以 `HistoryStore` 寫入 4 個示範工作階段後經 CDP 操作設定面板：清單顯示、截斷、搜尋 `codex` 只剩 Codex、搜尋不存在字串顯示空狀態、開啟時間軸對話框（工具名稱、權限等待 1 次、本機 Token 與快取、主要模型）、Esc 關閉、淺色模式焦點框。

## 安全審查

- 兩個 IPC 都以 `assertTrustedIpcSender(event, panelWindow)` 驗證寄件者，只接受設定面板 main frame；IPC 清單已重新產生（104 個 handler）。
- 輸入：全部執行期驗證、有界（見上），非物件輸入回預設查詢；明細 id 格式不符直接回 `null`，不碰資料庫。
- SQL injection：值全部綁定；LIKE 跳脫；`INDEXED BY` 名稱來自固定常數。測試涵蓋 `' OR 1=1 --`、`%`、`_`。
- 隱私：
  - 工具名稱只保留 `[A-Za-z0-9._:/@+ -]` 且 ≤ 64 字，參數不會進入 History（hook 本來就只送名稱，這裡再防一次）。
  - 專案只存最後一段資料夾名稱（去除控制字元、≤ 128 字），不存完整路徑；JSON 匯出清空專案名稱。
  - 回傳的 id 是 `adapter:agent:雜湊`，不含原始 session id；測試斷言輸出不含原始 session id、上層路徑或 `/Users/`。
  - 沒有新增 log。
- 明細 IPC 不檢查工作階段屬於哪隻寵物：資料都屬同一位本機使用者，id 也無法由 renderer 列舉以外的方式取得；記為已知行為。

## 殘餘風險

- 搜尋是子字串比對（`LIKE %x%`），無法用 B-tree 索引：最壞情況會掃描該寵物保留期內的所有工作階段（預設 90 天，每列只做字串比對）。一般用量（數百到數千筆）為毫秒級；若保留期設很長且工作階段極多才會明顯。
- `usage_key` 對照只涵蓋 Claude Code 與 Codex（只有它們有本機紀錄）；其他 Agent 顯示 hook 回報的 Token（標示「來自 hook 回報」）。若 Claude／Codex 日後改變本機紀錄中的 session id 與 hook session id 的對應，Token 會改為顯示 hook 值或空白，總覽的彙總不受影響。
- 「進行中／未完成」以 15 分鐘無事件為界，是推定而非 Agent 回報的事實。
- 清單以目前寵物為範圍（與總覽一致）；開啟專案寵物分流時，其他寵物的工作階段要切換寵物才看得到。
- 每次 hook 事件多維護三個 `sessions` 索引（`last_seen_at` 每次都會變）；微基準顯示在雜訊範圍內，但未在 Windows 或低階機器上量測。
- 未在 Windows 上實機驗證（依記憶，Windows 測試延後至 2026-11-09 之後）；macOS 已以隔離 Electron 驗證。

## 版本建議

**patch（1.11.1）**。雖然新增 schema v9，但完全是加法式、可自我修復的遷移，沒有改動既有欄位語意、公開 adapter／MCP 契約或安全邊界；新 IPC 是唯讀、只限設定面板的查詢，延續 history 既有模式。依 phase-gates「Phase 7 History：首次引入持久事件 schema 才建議 minor」的判準，本次不屬於首次引入，因此建議 patch。版本號待使用者確認後再更新。
