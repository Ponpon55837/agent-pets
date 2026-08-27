# Windows dev GPU startup repair

日期：2026-08-27
基準版本：`1.1.3`（本次不升版）
基準 commit：`9a2cbd0`

## 問題與範圍

Windows 桌機執行 `pnpm dev` 時，Electron 子程序以 `3221225477`（`0xC0000005`，access violation）結束；同一工作區直接執行 `pnpm exec electron .` 可正常啟動。修正只涵蓋 Vite 開發啟動與單機 opt-in 的 Windows dev GPU fallback，不修改 renderer、IPC、持久化格式或正式版 GPU 行為。

## 修正

- 覆寫 main 與 preload 的 `vite-plugin-electron` `onstart`，以 `['.']` 啟動 Electron，移除 plugin 預設的 `--no-sandbox`。
- 預設保留硬體加速；只有 Windows 未打包、存在 `VITE_DEV_SERVER_URL` 且單機 `.env.local` 明確設定 `AGENT_PETS_DISABLE_GPU=1` 時，才在 Electron ready 前停用硬體加速。正式版、未 opt-in 的 Windows、macOS、Linux 與直接 `electron .` 不套用。
- Vite 專用的啟動 helper 留在 `vite.config.mts`，Electron main 的平台判斷集中在 `electron/dev-runtime.ts`，不另建只有少量程式碼的 startup 模組；並新增回歸測試固定啟動參數、child-process environment 隔離及平台／模式／opt-in 邊界。
- 同步英文、繁體中文 README 與 build environment runbook。

## 安全檢查

- 改動恢復 Chromium renderer、GPU 與 utility process 的 sandbox，不擴張 renderer 權限。
- 無新增 IPC、HTTP、filesystem、credential、hook 或 MCP trust boundary。
- GPU fallback 僅改變明確 opt-in 的 Windows Vite dev 繪製後端；設定不使用 `VITE_` 前綴，不進 renderer bundle、不接受外部 payload，也不影響正式產物。

## 驗證與殘餘風險

- `tests/dev-runtime.test.mts`：3/3 通過，涵蓋安全啟動參數、child-process environment 隔離與 Windows dev-only opt-in 邊界。
- 完整 unit tests：108/108 通過。
- `vue-tsc --noEmit`：通過。
- Vite config 的變更範圍 type-check（`tsc -p tsconfig.node.json --noEmit --skipLibCheck --target ESNext`，build info 輸出至暫存目錄）：通過；未留下 tracked build artifact。
- `vite build`：通過；renderer 83、main 81、preload 2 modules，無 config loader 警告。
- `.env.local` 已確認受 `.gitignore` 排除；`pnpm@11.16.0 dev` native runtime 明確輸出 `Hardware acceleration disabled by AGENT_PETS_DISABLE_GPU for Windows development`。Vite、Electron、Presentation MCP、Permission Adapter 與 Event Server 均成功啟動並持續運作，未再出現 `3221225477`／`ELIFECYCLE`；檢驗後人工終止測試程序，無殘留 Electron／Node 行程。
- `pnpm@11.16.0 audit --prod --audit-level moderate`：`No known vulnerabilities found`。
- changed-file high-risk secret scan：未命中；`git diff --check`：通過。
- native smoke 記錄到 pet renderer 對 panel-only `project-pets-get-enabled` 的既有呼叫，被 `assertTrustedIpcSender` 正確拒絕且由 renderer catch；它不會終止程序，與 GPU 修正無關，本次不擴張範圍處理。
- 本機 Windows native smoke 已通過；自動化可確認程序穩定，但桌寵與面板是否無黑屏、閃爍等繪製異常，仍以使用者實際操作確認為準。
- 建議版本增量：patch；依專案 gate，驗證完成後仍須取得使用者確認才可升版。
