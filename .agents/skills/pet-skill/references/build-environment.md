# 建置與本機環境 runbook

這份 runbook 是 Agent Pets 後續每個 Phase、測試與發行工作的共同環境規則。

## 建置前程序清理

`pnpm build` 與 `pnpm electron:build` 會先執行 `scripts/stop-agent-pets.mjs`。Windows 上它只會關閉能以本專案路徑確認的程序：

- `release\\win-unpacked\\Agent Pets.exe`；
- 本專案 `release` 目錄下的 `AgentPets-*.exe`；
- 使用本專案 `node_modules\\electron\\dist\\electron.exe` 且 command line 指向本專案的開發程序。

它不會用程序名稱 `electron.exe` 做廣泛終止，也不會關閉其他專案、已安裝版本或 `pnpm dev`／Vite。若程序仍無法關閉，preflight 會停止建置並回報，避免半成品覆寫或檔案鎖定。

## pnpm 與依賴修復

- 專案固定使用 `pnpm@11.16.0` 與 `pnpm-lock.yaml`；不可新增 `package-lock.json`。
- 依賴安裝要保留 devDependencies、scripts 與 electron-builder 設定。不可用 production-only 安裝、prune 或其他會把 `package.json`／lockfile 縮成 runtime-only 的流程修復開發環境。
- Windows 若需要離線重建，優先使用使用者層級 store（目前環境為 `C:\\Users\\dgh\\AppData\\Local\\pnpm\\store\\v11`）：

  ```powershell
  $env:CI = 'true'
  $env:npm_config_confirmModulesPurge = 'false'
  pnpm.cmd install --offline --frozen-lockfile --reporter=append-only
  ```

- 不要在專案內建立或保留 `.pnpm-store`；不要為了顯示設定而修改全域 MCP 設定。
- 若 `node_modules/electron/dist/electron.exe` 不存在，先確認 Electron cache 的 zip checksum，再執行該版本的 Electron install script；不要拿 packaged Agent Pets exe 當 Node interpreter。

## 每次修復後的 gate

依序執行：

1. `pnpm.cmd exec vue-tsc --noEmit`（目前 package.json 沒有另設 `type-check` script）；
2. `pnpm.cmd test:unit`；
3. `pnpm.cmd build`；
4. `git diff --check`、`git status --short`，確認沒有 lockfile、生成物或 `.claude/` 的非預期變更；
5. 若涉及 packaged runtime，確認 `release\\win-unpacked\\Agent Pets.exe` 可啟動並在檢驗後關閉。

Phase report 必須記錄每個 gate 的實際結果、未測平台與殘餘風險。不得把「HTTP 204」、「靜態設定」或單純 type-check 當成實際桌面流程證據。

## UI 語言要求

繁體中文是後續使用者介面的必要語言，不是只寫在文件裡的偏好。新增或修改設定、Tray、通知、HUD、錯誤與 onboarding 文案時，必須同步提供繁體中文；跨平台 fallback、字串 key 與未來 i18n 抽離要維持同一語意。若當前 Phase 不包含完整 i18n，至少要在 phase report 標註尚未涵蓋的畫面，不得新增只存在英文的使用者可見功能。
