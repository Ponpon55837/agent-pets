# Phase 17 — 插件散佈

## 狀態

- 日期：2026-10-26
- 目前版本：`1.3.0`（未修改）
- 建議版本：`1.4.0`（僅供後續版本規劃，本 Phase 不修改版本號）
- 階段狀態：P17.0–P17.5 已完成；P17.5 威脅模型等待複檢。複檢通過前不開始 P17.6–P17.7。
- 分支：`feat/plugin-distribution`

## Checkpoint

| 編號 | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P17.0 | 散佈威脅模型 | `5866ca3b524ab749b87c6f4a88df7546e3f20f5b` | 通過 §0.4；338/338 單元測試 |
| P17.1 | Ed25519 簽章、TOFU 信任及金鑰變更確認 | `4a1766dc3f3cae6a5b2f14cb0e5dd7a539b09051` | 通過 §0.4；349/349 單元測試 |
| P17.2 | 線上插件目錄、套件大小與 SHA-256 驗證 | `96bd21fe59dca6d2024cd6e6ca10ff1b255a74a2` | 通過 §0.4；360/360 單元測試 |
| P17.3 | 手動更新清單與選用的每日目錄檢查 | `8b84ff69cacfbdec858e40e432453aaf7d4f0a06` | 通過 §0.4；366/366 單元測試 |
| P17.4 | 插件問題回報按鈕與 URL 驗證 | `b629497d79cd0b4d0e7f996607ec2155d97f679f` | 通過 §0.4；369/369 單元測試；隔離 Electron 與打包內容實測成功 |
| P17.5 | eventSource 威脅模型 | `e11732d3b06d7db9cc4cd722047c7feaed677d89` | 威脅模型完成；此 checkpoint 僅定義安全閘門，沒有新增 eventSource 執行能力 |

P17.5 的最後報告與驗收記錄由本報告的 checkpoint 收尾 commit 一併保存。P17.6、P17.7 尚未開始。

## 驗收對照

| 項目 | 結果 |
|---|---|
| P17.0 資產、攻擊者、信任邊界、降版、ID 搶註、金鑰、redirect 與惡意 archive 威脅 | 已在散佈威脅模型列出緩解與殘餘風險 |
| P17.1 簽章 payload、驗證、TOFU 與金鑰輪替 | 已實作；測試在執行時產生金鑰，沒有提交私鑰 |
| P17.2 目錄欄位、版本、下載大小與 SHA-256 驗證 | 已實作；目錄與下載有注入點；Phase 17 驗收沒有連到真實 GitHub |
| P17.3 更新比較與每日檢查 | 已實作；每日檢查預設關閉，只查目錄索引，不下載或安裝 |
| P17.4 回報 URL | 已實作；Main 限制目的地為 HTTPS GitHub issue form，標題只含插件 ID、版本及本機安裝標記；E2E 攔截 `shell.openExternal` |
| P17.5 eventSource 安全界線 | 威脅模型完成並等待複檢；未新增 API、manifest 欄位或執行期狀態列 |

## §0.4 checkpoint 檢查

每個 checkpoint 均依序執行 `pnpm exec vue-tsc --noEmit`、`pnpm test:unit`、`pnpm exec vite build`、`pnpm check:bundle`、`git diff --check`，全部通過後才 commit 並推送。

| Checkpoint | vue-tsc | test:unit | Vite build | check:bundle | diff check |
|---|---|---:|---|---|---|
| P17.0 | 通過 | 338/338 | 通過 | 通過 | 通過 |
| P17.1 | 通過 | 349/349 | 通過 | 通過 | 通過 |
| P17.2 | 通過 | 360/360 | 通過 | 通過 | 通過 |
| P17.3 | 通過 | 366/366 | 通過 | 通過 | 通過 |
| P17.4 | 通過 | 369/369 | 通過 | 通過 | 通過 |
| P17.5 | 通過 | 369/369 | 通過 | 通過 | 通過 |

`pnpm build` 與 `pnpm build:fast` 均未執行。未修改版本號、未建立 PR、未合併至 main、未新增 runtime 相依，亦未修改 `.claude/`。

## 安全檢查（§0.4b）

- `pnpm audit --prod --audit-level moderate`：`No known vulnerabilities found`。
- Phase 17 變更 diff 已掃描私鑰、GitHub／OpenAI／Slack token、AWS／Google API key、本機路徑與 email 格式。未發現私鑰、服務憑證、實際個人資料或本機路徑。掃描有 4 筆 email 格式命中，位於目錄與偏好設定的 URL userinfo 拒絕測試；逐筆確認是合成測試資料，未含真實帳號或憑證。
- P17.4、P17.5 新增 diff 另行掃描，未命中高信度秘密或個資格式。
- 既有歷史文件不在本次新增 diff 內；沒有改寫已推送歷史。

## Electron 實機驗證（§0.4a）

所有操作都在 `node scripts/e2e-isolated-electron.mjs` 啟動後、看到 `AGENT_PETS_E2E_READY` 才開始。隔離啟動器先替換成可逆假 `safeStorage`、建立暫存 userData/HOME，並把 `shell.openExternal` 替換為呼叫記錄器。沒有觸發鑰匙圈或系統權限視窗，沒有使用真實目錄連線，沒有開啟瀏覽器。

| 驗證 | 實際步驟與結果 |
|---|---|
| 開發輸出下的回報操作 | 透過 Main inspector 暫時 stub `dialog.showOpenDialog` 指向本機 `ok-notify` fixture；在隔離面板開啟 Developer mode、呼叫 `selectPluginFolder()`、`installPluginPlan()`，兩者成功。之後呼叫 `reportInstalledPluginIssue('ok-notify')`，結果為 `{ ok: true, value: { opened: true } }`。記錄器攔到一個 URL，其標題只有 `[local install] [ok-notify] 1.0.0`；沒有送出網路請求。 |
| safeStorage 起訖計數 | 開始：`{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`；結束：同為 `{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`。 |
| P16.6 打包內容驗收 | 執行 `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir --config.compression=store` 成功，簽章身分探索已關閉。以 `pnpm exec asar extract` 將 `app.asar` 解至暫存目錄，再用 `node scripts/e2e-isolated-electron.mjs --app-root <暫存目錄>` 啟動；未直接開啟 `.app`。重做 fixture 安裝與回報操作成功，URL 仍由 `shell.openExternal` 記錄器攔截。 |
| 打包 E2E safeStorage 起訖計數 | 開始與結束均為 `{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`。 |
| eventSource UI 與清除 | 未驗證：P17.5 僅完成威脅模型，功能需待複檢後的 P17.6 實作。 |

本次 Electron 驗收驗證的是 P17.4 回報按鈕及打包載入路徑；P17.7 的完整目錄安裝、簽章輪替、更新與 eventSource 實機矩陣尚未執行。

## 複檢者手動步驟

### P17.5 威脅模型複檢

1. 閱讀 `docs/security/plugin-event-source-threat-model.md` 的「建議的輸入與狀態契約」，確認只允許 `thinking`、`tool-running`、`idle`、`done`、`error`，並確認未知欄位拒絕。
2. 檢查「不得進入的能力與資料路徑」，確認插件狀態不進入 Event Server、內建 Agent store、Permission Broker、XP、成就、History、quota 或通知路徑。
3. 檢查保留 family 與「來自插件」標籤規則，確認插件不能顯示為 Claude、Codex 或 OpenCode。
4. 確認速率、session 數、payload 與 TTL 上限，以及 Generic HTTP 的既有副作用問題；決策完成後才開始 P17.6。

### P17.4 回報按鈕重驗

1. 在隔離環境執行 `pnpm exec vite build`，再執行 `node scripts/e2e-isolated-electron.mjs`，必須先看到 `AGENT_PETS_E2E_READY` 與 `fakeSafeStorage: true`。
2. 透過主程序 inspector 把 `dialog.showOpenDialog` 暫時指向 `tests/fixtures/plugins/ok-notify`，並記錄 `globalThis.__agentPetsE2E.calls` 起始值。
3. 在 Plugins 面板開啟 Developer mode，執行 `selectPluginFolder()` 與 `installPluginPlan()`；預期兩者成功。
4. 執行 `reportInstalledPluginIssue('ok-notify')`；預期成功，且 `globalThis.__agentPetsE2E.shellOpenExternalCalls` 僅出現一筆由 fixture 產生的 URL，title 只含本機安裝標記、插件 ID 與版本。
5. 再記錄 safeStorage 結束計數；預期起訖都維持 0，沒有真實瀏覽器開啟或 GitHub 請求。

## 待決問題與殘餘風險

1. 複檢者需確認 eventSource 的速率、session、payload、TTL 數值；未確認前不開始 P17.6。
2. 複檢者需確認既有 Generic HTTP ingress 收到 terminal success 時產生 XP／History 等副作用是否符合該 adapter 的產品預期。插件 eventSource 不會共用該 ingress。
3. 依使用者禁止提交個人識別資訊的要求，P17.4 沒有把特定帳號 repo URL 寫入程式；發行環境未設定 `AGENT_PETS_PLUGIN_ISSUE_REPORT_URL` 時，回報按鈕會顯示不可用。需決定發行環境如何提供非個資的目的網址設定。
4. P17.5 威脅模型尚未複檢；P17.6–P17.7 的 eventSource 實作、惡意 fixture、完整目錄驗收與最終打包矩陣均未驗證。
5. 目前僅在此 macOS 環境完成隔離與打包驗收；Windows/Linux 尚未驗證。
