# 線 4：打包、簽章與 CI

- **開始時間**：2026-11-10 22:21（Asia/Taipei）
- **基準**：`main` @ `38a75fa`（1.13.1）
- **分支**：`claude/packaging-ci-0b5718`（之後由總控合併到 `claude/integration-1-13-2`）
- **工作記錄**：`fd45630a-f195-4d49-aa3c-a6fe0578186d`（上層規劃 `d1b66599-3e15-4bb7-8d11-a928cfbfcbb7`）
- **版號**：不在本線變更；由總控在整合後統一升 patch。

## 1. 範圍與結果

原則：**沒有 secret 時 `release.yml` 的行為與產出物與 1.13.1 相同**，另外多出 Windows NSIS 安裝版與 Linux 產出；設定 secret 後自動啟用正式簽章。

| 項目 | 結果 |
|---|---|
| macOS 簽章與公證 | 有 `MACOS_CERTIFICATE_P12`／`MACOS_CERTIFICATE_PASSWORD` 時以 Developer ID 簽章（`--config.mac.identity=` 讓 electron-builder 從 `CSC_LINK` 的暫時鑰匙圈自動挑選、`forceCodeSigning`、hardened runtime、`build/entitlements.mac.developer-id.plist` 只含 `allow-jit`）；再有 `APPLE_API_KEY_P8`／`APPLE_API_KEY_ID`／`APPLE_API_ISSUER` 時由 electron-builder 對 `.app` 公證並 staple。沒有 secret 時維持 `mac.identity: "-"` 的 ad-hoc 路徑，指令與現在相同。 |
| ad-hoc 是否密封 | 已確認密封，不需修正（見 §2）。 |
| `check-mac-bundle.mjs` | 新增 `--expect-signed developer-id`（Authority、TeamIdentifier、非 adhoc、runtime 旗標、`spctl`）與 `--expect-notarized`（`spctl` 來源為 Notarized Developer ID、`xcrun stapler validate`），原有檢查不變。 |
| Windows | `win.target` 為 portable＋NSIS（x64）；NSIS 為 per-user、不提權、可選目錄、解除安裝保留 userData。有 `WINDOWS_CERTIFICATE_P12`／`WINDOWS_CERTIFICATE_PASSWORD` 時以 `WIN_CSC_LINK` 簽章，並以 `Get-AuthenticodeSignature` 驗證兩個 `.exe`。 |
| Linux | AppImage＋deb（x64）、`Utility` 類別；release matrix 新增 `linux`。README 標示為未驗證平台。 |
| CI 冒煙測試 | `scripts/ci-smoke-electron.mjs`（`pnpm test:smoke`）：隔離啟動 → 等 `AGENT_PETS_E2E_READY` 與事件埠 → POST 一筆事件（204）→ 經 CDP 確認 renderer store 狀態 → 經 inspector `app.quit()` → 確認以 0 結束 → 刪暫存 root。ubuntu（xvfb）、macOS、Windows runner 都會執行。 |
| renderer lint | ESLint 9 flat config（js／typescript-eslint recommended、vue `flat/essential`），涵蓋 `src/**`、`electron/**`、`tests/**`、`scripts/**`、`integrations/**`；`@/` 規則與 Node 測試閉包反向規則；`electron/**` 開 type-aware `no-floating-promises`。0 error、52 warning（全為 `no-explicit-any`）。 |
| 事件迴圈基準 | `ci.yml` 預留 `pnpm run --if-present bench:lag:check`；**預期 script 名稱：`bench:lag:check`**（由線 2 提供，不存在時步驟成功略過，已在 pnpm 12.8.1 確認退出碼為 0）。 |
| workflow 衛生 | 三個 workflow 的 action 全部固定到 commit SHA（附版本註解）、checkout `persist-credentials: false`、permissions 維持頂層 `contents: read`（只有 release job 有 write）、`ci.yml`／`ci-platforms.yml` 新增 Electron 二進位快取、`pnpm audit --prod --audit-level=high` 改為有漏洞才擋、連不上公告來源只警告。 |
| 依賴 | 升級 vue 3.5.45、@vitejs/plugin-vue 6.0.10、vite 8.3.7、electron 43.8.7、electron-builder 26.18.0、vite-plugin-electron 1.2.0；pinia／typescript／vue-tsc 範圍下限提到 lockfile 已有的版本。 |

## 2. 驗證證據

本機為 Intel Mac（x86_64），所以 ad-hoc 打包驗證用 x64（arm64 包在 Intel 上會因 koffi 是 x64 而失敗，這是 `build-environment.md` 記載的預期結果）。

- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --x64 --dir --publish never`：log 為 `identityName=-`、`skipped macOS notarization`，沒有鑰匙圈提示。
  - `node scripts/check-mac-bundle.mjs --app "release/mac/Agent Pets.app" --arch x64`：`codesign --verify --deep --strict: ok`、fuses 一致、15 個 Mach-O 皆為 x86_64，exit 0。
  - `codesign -dv`：`flags=0x10002(adhoc,runtime)`、`Sealed Resources version=2`，bundle 已密封。
  - 對同一個 ad-hoc app 加 `--expect-signed developer-id --expect-notarized`：正確回報非 Developer ID、無 TeamIdentifier、spctl 拒絕、無票據，exit 1。
- `--linux AppImage --x64` 與 `--linux deb --x64` 在 macOS 上完整產出 `AgentPets-1.13.1-x86_64.AppImage`、`AgentPets-1.13.1-amd64.deb`（deb 需要 `homepage`，以 `build.extraMetadata` 補上）。
- `--win nsis portable --x64` 在 macOS 上產出 `AgentPets-1.13.1.exe`、`AgentPets-Setup-1.13.1.exe` 與 `.blockmap`；`__uninstaller` 不留在 `release/`，兩個 artifact glob 只匹配兩個 `.exe`。
- 冒煙測試（本機，先 `pnpm exec vite build`）：`pnpm run test:smoke --offscreen --hook-port-base 28673 --timeout 120` 跑 3 次，事件 204 與 store 狀態 3 次都通過；第 1 次 `app.quit()` 後 20 秒內沒有結束（見 §4），第 2 次與加 `--tolerate-quit-hang` 的第 3 次乾淨退出（exit 0，約 26 秒）。結束後沒有本 worktree 的殘留 Electron 程序。
- 全套檢查（合併三條子線後）：
  - `pnpm exec vue-tsc --noEmit`：通過。
  - `pnpm lint`：0 error、52 warning，`main-process lint passed`（約 38 秒 wall）。
  - `pnpm test:unit`：1565 個測試，1562 pass、2 fail；失敗的是 `agent-hook-delivery`（時限 1188 ms）與 `presentation-stdio`（MCP 回應逾時），當時本機 load average 約 270（其他 session 同時在跑）。單獨重跑這兩個檔：9/9 通過。前一次完整執行（合併 ESLint 線前）1564 pass、0 fail。
  - `pnpm run check:design:strict`：通過（rawColors 0）；`pnpm check:contrast`：通過。
  - `pnpm exec vite build`、`pnpm check:bundle-size`、`pnpm check:bundle`：通過。
  - 受影響的 IPC 清單：`tests/ipc-inventory.test.mts` 與本線改動相關的測試（check-mac-bundle、login-item、relaunch、desktop-preferences、plugin-secrets-encryption）38/38 通過。本線沒有新增或變更 IPC channel。
  - 三個 workflow 以 YAML 解析器載入成功；`git diff --check` 通過。
  - `pnpm audit --prod --audit-level=high`：No known vulnerabilities found。
- 沒有執行 `pnpm build`／`pnpm build:fast`，沒有開啟打包後的 `.app`，沒有觸發鑰匙圈或系統權限提示。

## 3. 安全審查

- **secret 邊界**：secret 只透過 step `env` 進 shell；偵測步驟只輸出 `true/false`；憑證以 node 解碼到 `$RUNNER_TEMP/signing/`（目錄 700、檔案 600），`GITHUB_ENV` 只寫入檔案路徑；`Clean up signing files` 以 `if: always()` 刪除；沒有 `set -x` 或 echo secret。密碼在非簽章路徑以 `cond && secrets.X || ''` 給空字串。
- **觸發面**：`release.yml` 只在 push `main` 與 `workflow_dispatch` 執行，fork PR 拿不到 secrets；`ci-platforms.yml` 新增的 `pull_request` 觸發只限它自己與冒煙腳本，權限為 `contents: read`、不使用 secrets。
- **供應鏈**：所有 action 固定到 commit SHA；checkout 不保留憑證（version job 的 `git ls-remote` 依賴 repo 為 public，改為 private 時需調整）。
- **App 行為**：
  - Linux 沒有 keyring 時 Chromium 的 `safeStorage` 會落到 `basic_text`（固定金鑰混淆，不是加密）；`createSafeStorageEncryption` 把 `basic_text`／`unknown`／無 backend 視為不可加密，插件機密設定改為拒絕儲存。
  - 系統匣建立失敗只記錄訊息，不讓 App 崩潰。
  - NSIS 版的開機啟動改用 `process.execPath`（仍檢查絕對路徑、`.exe`、非 symlink）；portable 仍優先用 launcher。Linux 的開機啟動回報 `unsupported`。
- **測試隔離**：冒煙測試沿用隔離 HOME／USERPROFILE／userData 與假 `safeStorage`；token 路徑與 header 取自 `src/types/local-wire.ts`；啟動前確認事件、inspect、debug 埠都空閒，避免把事件或退出指令送到別的 App。Windows 上被攔截的 `security`／`claude`／`codex` 改導向 `cmd.exe /d /c "exit 1"`（原本的 `/usr/bin/false` 在 Windows 不存在，會觸發未處理的 ENOENT）。
- **個資**：提交內容不含本機路徑、帳號或憑證；deb 的 `maintainer` 用專案名稱與 repo URL，沒有編造 email。

## 4. 殘餘風險與未驗證項目

- **正式簽章路徑未實跑**：Developer ID 簽章、公證、staple、`spctl`／`stapler` 與 Windows Authenticode 需要真實憑證，只能等第一次有 secret 的 release run 確認。若正式簽章的 App 在 hardened runtime 下啟動被系統終止，依 crash log 判斷是否補 `allow-unsigned-executable-memory`（`release-signing.md` 已說明）。
- **CI 上的冒煙測試未實跑**：ubuntu 的 xvfb 與 `kernel.apparmor_restrict_unprivileged_userns=0`、Windows 的 inspector `app.quit()` 與 `taskkill`、macOS runner 都還沒在 GitHub Actions 執行過。若 runner 不允許 sysctl，改為設定 `chrome-sandbox` 的 SUID。
- **macOS 的 quit 卡住**：本機約三到六成的執行在 `app.quit()` 後（清理已完成、事件埠已關閉）不結束；子代理以只開一個隱藏視窗的空白 Electron app 重現（10 次 7 次），判斷為環境問題。`ci-platforms.yml` 只在 macOS 帶 `--tolerate-quit-hang`，事件埠沒關閉的真正卡住仍會失敗。
- **Linux 實機未驗證**：AppImage 啟動、系統匣、koffi linux-x64 載入、全螢幕偵測（Linux 回傳「未偵測」）、點擊穿透（Linux 已不啟用）都只有程式審查與單元測試。
- **Windows 實機未驗證**：NSIS 安裝／解除安裝、捷徑、開機啟動、重新啟動與單一實例、`resources/integrations` 與 `node.exe` 解析（`docs/ux-overhaul/windows-todo.md` 已標為「已實作、待實機驗證」）。
- workflow 沒有跑 actionlint／shellcheck（本機未安裝，依規則不安裝全域工具），只做 YAML 解析。
- `pnpm audit` 含 dev 依賴有 47 個 high（不在 `--prod` 範圍，不擋合併）。

## 5. 範圍外順手修正（給總控解衝突用）

| 檔案 | 所屬線 | 內容 |
|---|---|---|
| `electron/main/runtime.ts` | 線 2 | 約 8 行：`PluginSecretsStore` 改傳 `createSafeStorageEncryption(safeStorage)`；`desktopTray.create()` 包 try/catch。 |
| `electron/plugin-secrets.ts` | 插件 | 新增 `createSafeStorageEncryption`（Linux `basic_text` 降級）。 |
| `electron/desktop-preferences.ts`、`electron/login-item.ts` | 桌面 | NSIS 開機啟動路徑、Linux 開機啟動 `unsupported`。 |
| `scripts/e2e-isolated-electron.mjs` | 測試工具 | Windows 的攔截導向。 |
| ESLint 的最小修正 | 多線 | 刪除未使用的 import／變數約 20 處、刪除無呼叫者的 `plugin-panel-themes.ts` `gradientBackdrops()`、`src/types/electron-api.ts` 與 `src/composables/plugin/context.ts` 的相對 import 改 `@/` 等；檔案清單見 [phase-packaging-ci-lint-backlog.md](phase-packaging-ci-lint-backlog.md)。 |

留給其他線的 lint 存量（52 個 `no-explicit-any` warning）也列在該檔：主程序線 `electron/quota.ts` 10 處、hook 線 `electron/setup.ts` 3 處、renderer 線 `src/App.vue` 2 處與 `src/types/electron-api.ts` 1 處，其餘在測試。

## 6. 不做或延後

- **major 升級**：electron 45、pinia 4、typescript 7、vue-tsc 3、eslint 10。
- **koffi 3.3.7**：維持精確釘選 3.2.1；它只用在 Windows 前景視窗偵測，需要 Windows 實機驗證後再升。
- **EV／雲端簽章服務**：EV 憑證通常在硬體 token 上無法匯出 `.pfx`，目前不支援。
- **agent-pets-conventions skill**：在未追蹤的 `.claude/` 內，依規則不改。建議更新 §1：有 `tests/support/src-alias.mts` 的測試不受相對路徑限制，閉包改由 `scripts/node-test-closure.mjs` 與 ESLint 自動檢查。

## 7. 版號建議

本線沒有持久化 schema、IPC 或公開契約變更，發版產物新增 NSIS 與 Linux。依總控規劃，與其他線一起升 **patch**（1.13.2）。
