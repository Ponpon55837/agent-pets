# pnpm 升級至 12.8.1

日期：2026-10-01  
開始時間：2026-10-01 20:21（Asia/Taipei）  
基準分支：`main`  
基準 commit：`f1b0032`  
基準應用程式版本：`1.2.2`

## 範圍與變更

- 將 `package.json` 的 `packageManager` 固定版本由 `pnpm@11.16.0` 升至 `pnpm@12.8.1`。
- 以 pnpm 12.8.1 更新 `pnpm-lock.yaml` 的套件管理器 metadata 與完整性資訊；應用程式依賴版本沒有變更。
- 同步更新專案地圖與建置環境文件中的 pnpm 固定版本。
- 未修改應用程式版本、執行階段程式碼或產品契約。

## 驗證

| 檢查 | 結果 |
|---|---|
| `pnpm --version` | 通過，輸出 `12.8.1`，沒有舊版切換警告 |
| `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts --trust-lockfile` | 通過，使用 pnpm v12.8.1；`--trust-lockfile` 會略過供應鏈政策檢查 |
| 一般離線 frozen lockfile 檢查 | 未完成；供應鏈政策檢查缺少本機 registry metadata（`ERR_PNPM_NO_OFFLINE_META`，`@electron/fuses`），不是 lockfile mismatch |
| `git diff --check` | 通過 |
| 應用程式建置與測試 | 未執行；本次只變更套件管理器 metadata 與工具文件 |

## 安全檢查與殘餘風險

- 沒有新增執行階段套件或改動 Electron、IPC、HTTP、filesystem、credential、hook、MCP 等信任邊界。
- lockfile 新增的 pnpm 12.8.1 項目含 integrity metadata；應用程式既有依賴的版本與解析結果未變。
- 本機離線快取沒有完成供應鏈政策 metadata 檢查；此項需在可連 registry 的環境另行確認。

## 版本與發布

- Agent Pets 應用程式版本維持 `1.2.2`，不需應用程式 semver 升版。
- 不建立 Git tag 或發布套件。

## 後續必要性評估

評估日期：2026-10-01
開始時間：2026-10-01 21:04:47（Asia/Taipei）

使用者詢問專案是否真的需要升級；若不需要，則取消 PR 並更新工作記錄。檢查發現 README 僅要求 pnpm 11 以上，升級前固定為 11.16.0，且專案沒有 `.github/workflows`。這些設定本身沒有要求 pnpm 12。

但在本機暫時還原固定版本以驗證相容性時，pnpm 12.8.1 嘗試切換到專案指定的 `@pnpm/exe@11.16.0`，因該版本沒有 `darwin-x64` 原生執行檔而失敗：

| 檢查 | 結果 |
|---|---|
| 專案固定 `pnpm@11.16.0` 時執行 `pnpm --version` | 警告 `ERR_PNPM_PNPM_ENGINE_NO_NATIVE_BINARY`；僅回退使用全域 `12.8.1` 後才印出版本 |
| 專案固定 `pnpm@11.16.0` 時執行 `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts --trust-lockfile` | 失敗；無法在 `darwin-x64` 啟動固定的 11.16.0 |
| 恢復專案固定 `pnpm@12.8.1` 後 | 保留本報告前述 12.8.1 frozen-lockfile 驗證結果 |

因此專案需要固定一個可在目前 macOS x64 開發環境執行的 pnpm 版本；11.16.0 不符合，12.8.1 可用。本次還原只在本機暫時測試，已清除且未提交，PR #5 維持合併狀態。應用程式依賴、版本及執行階段程式碼均未變更。
