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
