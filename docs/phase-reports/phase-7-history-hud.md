# Phase 7 驗證報告：History / HUD

## 狀態

- 目前版本：`0.8.1`
- 建議下一版本：`0.9.0`（minor；新增持久化 History schema、聚合資料管線、local usage reader 與 panel-only IPC）
- 版本尚未升級，等待使用者確認後才會修改 `package.json`。

本階段把事件、Quota 與 Codex／Claude 本機 session-log token usage 的可讀價值放入本機 History HUD，同時把「為專案設定 MCP」從設定內容層抽成獨立完整面板。History 與 XP／成就資料分開保存；清除 History 不會重設寵物成長，也不會讓舊 log 在下一次掃描時立即回填。

## 交付內容

- `electron/history.ts`：main-owned SQLite History Store，包含 schema migration、WAL、事件去重、bounded active-time、sessions、daily_stats、quota snapshot 與 raw event retention。
- `electron/local-usage.ts`：main process 唯讀掃描固定 Codex／Claude JSONL session-log roots，解析 `token_count`／assistant `usage`，合併 cache／reasoning 到既有 input／output buckets，去重串流紀錄與限制檔案／行大小。
- `src/types/history.ts`：History summary、daily aggregate、quota、export／clear command contract。
- `electron/event-normalizer.ts`／`src/types/agent.ts`：受限的 `eventId`、`sourceEventId` 與 exact／estimated token usage 欄位；不把原始 payload 送入 renderer。
- `electron/main.ts`／`electron/preload.ts`／`src/env.d.ts`：panel-only `history-summary`、`history-clear`、`history-export` 與 `history-updated` IPC。
- `src/components/StatusPanel.vue`：History tab，提供七日工作量、完成／失敗、active time、逐 Agent token input／output、token 品質、寵物 progression、匯出與清除；Quota 只在「Token 剩餘」分頁顯示，避免重複卡片。
- `src/components/ProjectMcpPanel.vue`：獨立 MCP 完整面板；設定頁只保留入口按鈕。面板包含資料夾選擇、三個 client 狀態、refresh、安全移除／忘記記錄與衝突提示。
- MCP 面板 shell 會沿用 Setup Wizard 的 overlay、標題列、按鈕、列表卡片與安全提示樣式；Electron panel window 會在開啟時從 380px 展開至 680px，關閉後恢復設定頁尺寸。
- `src/i18n.ts`、雙語 README、project map 與 roadmap 補充說明。
- `tests/local-usage.test.mts`：Codex／Claude fixture、串流去重、敏感內容不落地與 Clear cutoff 回歸測試。

## Acceptance criteria

| 項目 | 結果 | 證據 |
|---|---|---|
| 七日 HUD 使用 aggregate，不掃描 raw events | 通過 | `HistoryStore.getSummary()` 只查詢 `daily_stats`；raw events 僅供寫入、retention 與明確 rebuild job 使用 |
| 多 project／adapter 同日資料會完整合併 | 通過 | `getSummary()` 先按 local date fold 所有 aggregate rows；history test 驗證跨 project token 30 input／13 output |
| exact／estimated token 可辨識 | 通過 | `historyTokenLabel()` 與 UI badge 顯示 `精確來源`／`估算值`／無資料 |
| Codex／Claude 本機 log token usage 可匯入 History | 通過 | `LocalUsageReader` 掃描固定 roots，解析 Codex `token_count` 與 Claude assistant `usage`；測試驗證 cache／reasoning 合併、streaming 去重與 History totals |
| token 使用量按 Agent 分開顯示，且切換寵物不會變成 0 | 通過 | `HistoryAgentStat` 回傳各 adapter 的 input／output／quality；本機 log 使用全域 `local-usage` bucket；回歸測試驗證 Codex／Claude 分列與其他 pet summary |
| 舊 log 不會在 Clear History 後立即回填 | 通過 | History schema v2 保存 local-log cutoff；測試驗證清除後舊資料不回來、cutoff 後新事件可匯入 |
| raw data retention 不影響 XP／成就 | 通過 | History 使用獨立 `history.sqlite`；`clear()` 只清除 History tables，progression tests 維持通過 |
| Clear History 不等於 Reset Pet | 通過 | panel confirmation 明示不重設 XP、level、evolution、mood、achievements；IPC 不呼叫 progression store |
| export 不洩漏 prompt、tool args、secret、完整 project path | 通過 | events payload 只保存 `{ state }`；project/session 只存 hash；export 只輸出 summary；security test 驗證敏感字串不出現 |
| 專案 MCP 為獨立完整面板 | 通過 | `ProjectMcpPanel.vue` 獨立 overlay；StatusPanel 只保留入口；store 開啟時將 panel height 調至 720px，關閉回到 Settings |
| MCP install/remove 原有安全邊界不變 | 通過 | 既有 project-mcp installer／registry tests 全部通過；面板只呼叫既有 typed preload API |

## 驗證與安全檢查

- `pnpm.cmd test:unit`：通過，77/77。
- `node node_modules\\vue-tsc\\bin\\vue-tsc.js --noEmit`：通過。
- `pnpm.cmd exec vite build`：通過，renderer／Electron main／preload 均完成編譯。
- `pnpm.cmd build`：通過；建置前 preflight 關閉 PID 39368（本專案 portable Agent Pets），產出更新後的 `release\\AgentPets-0.8.1.exe` 與 `release\\win-unpacked`（portable 102,008,696 bytes，2026-08-13 17:03:35）。
- `pnpm.cmd audit --prod --audit-level moderate`：通過，`No known vulnerabilities found`。
- `git diff --check` 與新檔案 trailing whitespace 檢查：通過（僅有既有 Git ignore 權限警告）。
- secret scan：非測試程式碼無高風險 secret pattern；測試中的 `must-not-persist`／`opaque-handle` 是資料清理 fixture。
- strict UTF-8／replacement character scan：通過。

## 已知限制與風險

- 本階段尚未加入 per-project pet binding、project filter、achievement rule 或 Shimeji；它們仍依 roadmap Phase 8–10 執行。
- Quota 歷史快照只保留 bounded、sanitized provider/window projection；不保存 credentials 或原始 quota response。
- Windows packaged runtime 的 native folder picker、History export dialog 與實際 MCP client round-trip 仍需在使用者桌面 session 做最後手動驗收；自動化檢查已涵蓋 IPC trust、installer／registry、schema 與資料清理邊界。

## 版本 gate

本階段包含新的持久化資料 schema、聚合 job、export／clear IPC 與獨立 MCP UI panel，依專案規則屬於 minor 版本變更。完成最終 build、audit、secret scan 與 packaged sanity 後，停止等待使用者確認是否升級至 `0.9.0`；在確認前不改版號、不 commit。
