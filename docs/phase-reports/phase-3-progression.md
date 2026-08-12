# Phase 3 驗證報告：XP／Level／Evolution 與 Growth chip

日期：2026-08-12
目前版本：`0.7.0`
階段狀態：已完成並經使用者確認
版本／提交：已升版；提交於本報告更新後建立

## 本階段結果

Phase 3 將短期的 Mood 與可持久化的 XP 成長分開處理，並把兩者集中到設定面板的獨立 `Growth` chip。一般 `Settings` 頁面不再放置 Mood 或 XP 卡片，只保留尺寸、桌面偏好、反應、Setup Wizard、Restart 與 Quit；`Pets` chip 的多寵物與匯入流程維持原行為。

## 實作範圍

- `src/types/progression.ts`：集中 XP policy、Level 曲線、Evolution stage 與 renderer 可用的 snapshot 型別。
- `electron/progression.ts`：main process 擁有的 SQLite `ProgressionStore`，負責 migration、transaction、去重 ledger、active coding 累積與 streak。
- `electron/main.ts`：建立 progression service、接收 normalized event、廣播 snapshot，並驗證 progression pet ID 與 IPC sender。
- `electron/preload.ts`、`src/env.d.ts`、`src/stores/agentStore.ts`、`src/App.vue`：只暴露 typed、sanitized 的 progression snapshot 與選取寵物操作。
- `src/components/StatusPanel.vue`：新增 `Growth` chip；Mood、XP／Level／Evolution／Streak 只在該 chip 顯示，儲存尚未就緒時採安全降級提示。
- `README.md`、`README.zh-TW.md`、架構文件與 `pet-skill` project map：同步記錄資料邊界、使用方式與後續實作入口。

## XP v1 規則

| 事件／條件 | XP | 限制 |
|---|---:|---|
| canonical session 完成 | +20 | 以 source／session 去重一次 |
| 每個本地日第一次完成 | +10 | 每隻 pet 每日一次 |
| 觀察到 30 分鐘 active coding | +2 | 每個 session 最多 +10；只計 thinking／tool-running 的觀察區間 |
| 延續前一天 streak | +5 | 每隻 pet 每日一次 |
| failed／cancelled | +0 | 不扣永久 XP |
| token milestone | 暫不發放 | 等待事件契約能提供精確 token 數 |

Level 使用整數公式 `xpToNext(level) = 100 + 25 × (level - 1)`，Evolution stage 為 Egg（1）、Baby（5）、Teen（10）、Adult（20）、Master（35）。Mood 仍是短期狀態，不寫入 progression ledger。

## 持久化與安全邊界

資料庫位於 main process 的 `app.getPath('userData')/progression.sqlite`，目前 schema migration `progression-v1` 包含：

- `schema_migrations`：migration version、名稱與 checksum。
- `pets`：寵物識別、顯示名稱、sprite id、default／archived 狀態。
- `pet_progress`：total XP、level、streak、最後完成日期與累積統計。
- `xp_ledger`：每筆 XP award 的 rule、source、session、local day 與 idempotency key；唯一索引阻擋重播。
- `xp_session_activity`：只保存 active milliseconds、已發放點數、最後狀態與時間，不保存 prompt、工具參數、project path 或憑證。

每次 event 的 progression 更新在單一 transaction 內完成；active interval 會限制為最多五分鐘，避免 app 關閉或事件中斷造成一次性大量 XP。Renderer 沒有資料庫路徑、SQL 或 handle，所有讀寫都經由第一方 frame 驗證與 typed IPC。

## Liquid Glass 與 UI gate

- `Growth` 使用現有 regular Liquid Glass chip／card 語彙，沒有再疊加第二層 blur。
- XP bar、Mood bar 都保留清楚的 progress semantics 與 `aria-valuenow`。
- `prefers-reduced-motion` 會縮短 progress transition；`prefers-contrast: more` 與 `prefers-reduced-transparency: reduce` 有不透明、高對比 fallback。
- 進度資料尚未準備完成時顯示 bounded、非互動的狀態訊息，不偽造或暫存成永久 XP。

## 驗證結果

| Gate | 結果 |
|---|---|
| `npx.cmd vue-tsc --noEmit` | 通過 |
| `npm.cmd run test:unit` | 通過，41／41 tests |
| progression targeted tests | 通過：policy、完成去重、失敗不加分、active cap、streak、restart persistence |
| `npx.cmd vite build` | 通過：renderer 46 modules、main 17 modules、preload 2 modules |
| `pnpm.cmd build` | 通過；Electron 43.3.0／electron-builder 26.15.3，包含 portable target |
| portable artifact | `release/AgentPets-0.6.0.exe`，101,860,019 bytes，SHA-256 `2181B63EDA29269AD2CE7B1BB6D301B7D9E63BBDC776A62311CD97537229E04C` |
| `pnpm.cmd audit --prod --audit-level moderate` | `No known vulnerabilities found` |
| high-risk secret scan | 未命中 private key、AWS、GitHub、OpenAI 或 Slack token 樣式 |
| `git diff --check` | 通過，沒有 whitespace／line-ending 錯誤 |

## Packaged runtime smoke

已啟動 `release/win-unpacked/Agent Pets.exe` 並確認程序可存活，測試結束後只停止與該精確 executable path 相符的程序。現有 user-data 的 `progression.sqlite` 已驗證包含 `progression-v1` migration 與 default pet rows。

本機目前有背景 Electron instance，且 packaged log 顯示 GPU process 在隔離啟動時因環境 driver 失敗；因此用 `--user-data-dir` 的隔離 profile 沒有重建 app-level progression DB。這是本機 packaged E2E 環境限制，不代表 schema 或 development tests 失敗；下一次可在所有背景 Electron instance 關閉、使用實際 Windows GPU 的環境重跑 native persistence smoke。

## 殘餘風險與刻意延後

- active coding XP 是以收到的狀態事件觀察時間估算，不是 agent 端精確計時；五分鐘 gap cap 是防濫發的保守邊界。
- token milestone 等待精確 token event contract，不從 quota 百分比或 prompt 內容推算。
- macOS／Linux 的 packaged native 行為尚未在本機驗證；Windows portable build 與 SQLite schema 已完成 gate。
- 本階段沒有新增雲端、帳號、同步或生產力插件能力。

## 確認後動作

使用者已確認 Phase 3；依版本規則已把 `0.6.0` 升為 `0.7.0`。本階段提交完成後會補上 commit hash；依使用者要求不因升版再次執行 build。
