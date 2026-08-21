# Phase 9 Follow-up — Achievement／History Session Consistency

日期：2026-08-21
基準 commit：`b954c95`（`main`）
基準版本：`1.1.2`
完成版本：`1.1.3`
版本狀態：使用者已確認 patch 升版

## 問題與範圍

History 的 `sessions_completed` 原本對每個不同 event id 的 `success` 都加一；Achievement 則以 pet／source／session／project 身分去重。因此同一個 session 重複送出 `success` 時，History 會快速超過成就門檻，但 `getting_serious` 仍維持鎖定。本 follow-up 只修正 History／Achievement 的 main-process SQLite truth、啟動協調、測試與文件；沒有修改 renderer UI、IPC contract、hook、MCP、permission 或 XP 規則。

## 驗收結果

- 同一 pet／source／session／project 的不同 `success` event id 只算一個完成 session。
- 同一 session 先出現 `error`、之後成功時，以成功作為 durable outcome；舊的失敗 aggregate 會移除。
- History schema migration v4 保留 active time、token aggregate 與 quota 資料，只重建完成／失敗 session 計數。
- Achievement 與 History Store 都可用且成就已啟用時，main process 會以 bounded completion facts 回填 `completed_sessions`。
- 回填沿用 Achievement `session-v1` key 與 `INSERT OR IGNORE`；重啟、重跑 migration 或重新啟用追蹤不會重複解鎖或通知。
- 停用成就時不執行回填；重新啟用後才執行。
- 沒有直接覆蓋或讀取使用者命名的備份目錄；本機舊備份中的 37 個 session key 已全部被 History 回填涵蓋。

## 驗證證據

| Gate | 結果 |
| --- | --- |
| `vue-tsc --noEmit` | 通過；完整 build 亦再次執行 |
| `pnpm.cmd test:unit` | `105/105` 通過；包含重複 success、error→success、跨 adapter 去重、v4 aggregate 修復、token 保留與 100-session idempotent backfill |
| `pnpm.cmd exec vite build` | renderer、Electron main 與 preload bundle 通過 |
| `pnpm.cmd build`（升版前） | 通過 type-check、Vite、Windows unpacked 與 portable packaging；輸出 `release\AgentPets-1.1.2.exe` |
| `pnpm.cmd build:fast`（升版後） | 通過 type-check、Vite、Windows unpacked 與 store-compression portable packaging；輸出 `release\AgentPets-1.1.3.exe` |
| Offline frozen lockfile | `pnpm.cmd install --offline --frozen-lockfile` 通過；lockfile 已是最新且無 diff |
| 即時資料庫一致性副本 | History 近七日 `209 → 36`；Calcifer Achievement ledger `10 → 59`；舊備份 37 個 session 中遺漏 `0` |
| Packaged Electron smoke | `release\win-unpacked\Agent Pets.exe` 以 isolated userData 啟動；migration=`history-unique-terminal-sessions`、History=`36`、Achievement=`59`、`getting_serious=false` |
| `pnpm.cmd audit --prod` | `No known vulnerabilities found` |
| Secret scan | 完整 repo 命中僅為既有 API-key 模式判斷／README 說明；本次 diff 無 secret pattern 命中 |
| `git diff --check` | 通過 |

## 安全與效能檢查

- 沒有新增 renderer／preload／IPC、local HTTP、MCP、permission、credential 或 notification trust boundary。
- 回填只在 main process 的既有 SQLite stores 之間傳遞 allowlisted completion fields；不傳到 renderer，也不保存 prompt、工具參數、憑證或完整專案路徑。
- backfill query 上限為 100,000 筆 terminal event；SQL 使用 prepared parameters。
- live event hot path 只在 `success` 時多做一次有複合索引支援的存在性查詢；thinking／tool-running heartbeat 不增加查詢或檔案 I/O。
- migration 與回填均使用既有 transaction／unique-key idempotency；Achievement Store 不可用時仍維持 additive fail-safe，不阻擋 History、XP 或事件接收。
- 本 phase 無視覺或互動變更，Liquid Glass、對比、動態效果、click-through 與多螢幕 gates 不適用。

## 殘餘風險

- 成就回填只能使用 History raw-event retention 內仍保留、可重建 canonical identity 的 session；早於 retention 且只剩 aggregate 的紀錄不能安全猜測 session key。本機現有舊備份已驗證沒有缺漏。
- History 畫面是近七日視窗，Achievement 是 lifetime ledger；修正後本機證據分別為 36 與 59，數字不必相同，但兩者不再因重複 `success` 而矛盾。
- 已在 Windows packaged Electron 實測；macOS／Linux 的 SQLite migration 與 package runtime 尚未在本環境執行，不能由 Windows 結果推論。
- 本次只建出候選 artifact，沒有安裝、覆蓋使用者目前執行的版本或直接修改 live userData；實際資料會在執行含本修正的成品後自動 migration／回填。

## 版本結果

這是 Phase 9 的 contained consistency／migration follow-up；使用者已確認採 patch 升版至 `1.1.3`。`package.json` 已更新；`pnpm-lock.yaml` 沒有 root package version metadata，offline frozen-lockfile 驗證通過且無需修改。升版後 type-check、unit（`105/105`）、audit、diff 與 Windows fast packaging 均通過，portable artifact 為 `release\AgentPets-1.1.3.exe`。
