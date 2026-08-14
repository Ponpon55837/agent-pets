# Phase 9 — Achievements

## 狀態

- 實作基線：`76c917d`（Claude 已獨立提交 Phase 8 第二輪 token 計算修正）
- 目前版本：`0.10.0`（本階段尚未升版）
- 本階段狀態：功能與安全檢查完成，等待使用者確認後才進行版本變更
- 版本建議：`0.11.0`。雖然 roadmap 將 Phase 9 預設列為 patch，但本次新增 main-owned SQLite schema、migration 與 renderer IPC contract，依 phase-gates 的實際 diff 判定屬於新的持久化子系統。

## 交付範圍

### 規則與持久化

- `src/types/achievement.ts` 提供 versioned registry、純函式 evaluator、10 個第一版規則與 token quality (`exact`／`estimated`)。
- `electron/achievements.ts` 建立獨立 `achievements.sqlite`，包含 migration、pet-scoped aggregate、unlock ledger 與 `(pet_id, achievement_id, version)` 唯一鍵。
- 規則包含首次完成、100 sessions、Night Owl、1M token、三種 Adapter、單日 20 sessions、7 日 streak、30 個 active days、Level 10／20。
- event replay、重開 App、同一 session 重複 success 都不會重複解鎖或通知。
- 高頻的 thinking／tool-running heartbeat 若沒有明確 `tokenUsage` 不會開啟成就交易；只有 success 或帶 token usage 的事件進入 evaluator。

### Desktop／IPC／UI

- `DesktopPreferences` 新增 main-owned `achievementsEnabled`，預設開啟並持久化；關閉後停止新的 evaluator side effect，不刪除既有 ledger。
- 新增 trusted-renderer-only `achievements-init` IPC，以及 `achievements-updated`／`achievement-unlocked` 廣播。
- Growth chip 新增成就圖鑑、進度計數、精確／估算品質標示與獨立開關；文案同時提供繁體中文與 English。
- 解鎖時使用一次性 native notification 與獨立 visual reward hook；reward 不授予 Permission、MCP、檔案或命令能力。
- UI 使用既有 Card／ToggleRow／Icon 與 Liquid Glass tokens，支援 focus、contrast 與 reduced-motion 路徑。

### 與 token 重構的邊界

Claude 的 `76c917d` 已修正 local log project registration 與 Codex reset overcount。本階段不再修改：

- `electron/project-routing.ts`
- `electron/local-usage.ts`
- `electron/history.ts`
- `tests/local-usage.test.mts`
- `tests/project-routing.test.mts`

Achievements 目前消費 canonical live event 的 `tokenUsage`，因此可以顯示 exact／estimated quality；本機 log 匯入到成就 ledger 的串接等 token 修正同步契約穩定後再接回，避免重新改動上述保留檔案。

## Acceptance criteria

| 條件 | 結果 | 證據 |
|---|---|---|
| 同一成就每 pet 只解鎖一次 | 通過 | `tests/achievements.test.mts`：重複 success、restart、snapshot 去重 |
| Replay／aggregate 不重複通知 | 通過 | SQLite primary key 與 `INSERT OR IGNORE`；targeted tests |
| Night Owl 使用一致本地時間規則 | 通過 | injected `localHour` 測試 04:59／05:00 邊界 |
| Token 成就顯示資料品質 | 通過（live event path） | exact／estimated targeted test 與 Growth gallery copy |
| 成就不授予安全能力 | 通過 | evaluator 只讀 aggregate/context；無 permission、command、file、MCP mutation path |
| 新增規則不需改 renderer event flow | 通過 | registry evaluator 與 store ledger 分離；renderer 只接 snapshot/unlock projection |
| 使用者可停止新的成就 side effect | 通過 | main-owned `achievementsEnabled` preference、IPC、desktop-preferences persistence test |
| Liquid Glass / accessibility | 通過（靜態 gate） | shared Card／ToggleRow／Icon、tokens、focus-visible、reduced-motion；待實機目視確認 |

## 驗證證據

- `vue-tsc --noEmit`：通過。
- targeted achievements + desktop preferences tests：9/9 通過。
- 全部 unit tests：96/96 通過。
- Vite client／Electron source build：通過。
- `pnpm audit --prod --audit-level moderate`：No known vulnerabilities found。
- source-scoped credential scan（排除 `node_modules`／build output／`.claude`）：未發現 credential-shaped literal。
- `git diff --check`：通過。
- packaged smoke：以隔離 `.tmp-phase9-smoke` user-data 啟動 `release/win-unpacked/Agent Pets.exe`，成功建立 `achievements.sqlite`、`progression.sqlite`、`history.sqlite` 與 `project-routing.sqlite`；SQLite 查詢確認 `schema_migrations` 為 `achievements-v1`、unlock table 可讀。測試資料已清除。
- `pnpm build`：正式 exit code 0；prebuild 回報找不到本專案正在執行的 Agent Pets，client／main／preload 與 Windows portable packaging 全部完成（`release/AgentPets-0.10.0.exe`）。

## 安全檢查

- IPC `achievements-init` 使用既有 `assertTrustedIpcSender`，pet ID 使用 allowlist；renderer 對 snapshot／unlock 再做 schema、definition key、版本、數值與長度驗證。
- SQLite 路徑固定於 Electron `userData`，migration 使用 bounded schema version；pet／adapter／event IDs 只以 allowlist／hash 進入 query，沒有 raw project path、prompt、tool args 或 secrets。
- unlock notification 只顯示內建 i18n title／description 與品質，不回傳 event payload。
- 成就資料庫故障會 fail-open 到「沒有成就 projection」，不阻塞 event receiver、Permission、History 或 XP；錯誤只寫入 main diagnostic log。
- notification 仍受 notifications／DND／foreground policy 控制；一次性 unlock 由 ledger 保證，不靠 renderer 計時或 localStorage。

## 剩餘風險與後續

- 尚未在 macOS native runtime 做 packaged smoke；Windows packaged runtime 已驗證。
- Growth gallery 尚需使用者在實際 Electron 視窗確認窄寬、暗色／高細節桌布、通知與 reward animation 的視覺效果。
- 本階段不改動 Phase 8 第二輪 token 檔案；待使用者確認 token 修正同步契約後，再將 local log token records 接入同一個 achievement ledger，並補對應整合測試。
- 版本尚未修改；收到使用者明確確認後，才會同步更新 `package.json`／`pnpm-lock.yaml`、重跑完整 gate 並 commit。
