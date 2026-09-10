# Windows development GPU safe mode

日期：2026-09-10  
基準版本：`1.1.3`  
完成版本：`1.1.4`  
基準 commit：`9a2cbd0`

## 問題與範圍

部分 Windows 顯示驅動在 Vite 開發模式啟動 Electron 時，Chromium GPU process 會以 `3221225477`（`0xC0000005`）結束。編譯或 electron-builder 封裝不會建立此 GPU runtime，因此修正只涵蓋開發版 Electron 啟動，不改變 production build 或正式版硬體加速策略。

問題診斷與原始修正方向由 [PR #2](https://github.com/Ponpon55837/agent-pets/pull/2) 的 `benshih28` 提供；本次另外實作不需使用者建立 `.env.local` 的安全模式。

## 修正

- 新增 `pnpm dev:safe`，以 Vite `gpu-safe` mode 啟動；不需建立或維護任何本機環境檔。
- 覆寫 main 與 preload 的 `vite-plugin-electron` `onstart`，以 `['.']` 啟動 Electron，不帶 plugin 預設的 `--no-sandbox`。
- safe mode 只透過隔離的 Electron child environment 傳給 main process，不暴露給 renderer。
- 只有 Windows、未打包、存在 Vite dev server 且明確使用 safe mode 時，才在 `ready` 前呼叫 `app.disableHardwareAcceleration()`。
- 一般 `pnpm dev`、packaged build、正式版、macOS 與 Linux 都維持硬體加速。
- 同步英文、繁體中文 README 與 build environment runbook。

## 驗證

| Gate | 結果 |
|---|---|
| `tests/dev-runtime.test.mts` | 3/3 通過，涵蓋 sandbox argv、隔離環境與平台／模式／packaged 邊界 |
| `pnpm.cmd test:unit` | 108/108 通過 |
| `vue-tsc --noEmit` | 通過；因本機 pnpm shim 無法解析 `vue-tsc`，改用同一專案已安裝的 `.cmd` 執行檔 |
| Vite config TypeScript | 通過 |
| `pnpm.cmd build` | 通過 type-check、renderer/main/preload build、Windows unpacked 與 portable packaging |
| `pnpm.cmd dev:safe` | 不需 `.env` 即穩定啟動；main argv 為 `electron.exe .`，renderer 保有 `--enable-sandbox`，GPU process 使用 `d3d11-warp-webgl` |
| `pnpm.cmd dev` | 穩定啟動；GPU process 未使用 WARP，renderer 未出現 `--disable-gpu-compositing` |

## 安全檢查與殘餘風險

- 無新增 IPC、HTTP、filesystem、credential、hook、MCP 或持久化 trust boundary。
- 移除開發啟動的 `--no-sandbox`，沒有擴張 renderer 權限。
- safe mode child preference 不使用 `VITE_` 前綴，不進 renderer bundle，也不接受外部事件 payload。
- native smoke 仍會看到 pet renderer 對 panel-only `project-pets-get-enabled` 的既有呼叫被 `assertTrustedIpcSender` 拒絕並由 renderer catch；它不會終止程序，與本修正無關。
- 本機無法重現貢獻者顯示驅動的原始 access violation；已驗證軟體繪製路徑與一般硬體加速路徑正確隔離。
- macOS／Linux 未做 native smoke；平台 guard、單元測試與 production build 已涵蓋不啟用 safe mode 的邊界。

## 版本

此改動是 contained Windows development startup fix，不改變正式版 public contract 或 persistent schema，因此使用者確認採 patch 升版至 `1.1.4`。`pnpm-lock.yaml` 沒有 root package version metadata，無需修改。
