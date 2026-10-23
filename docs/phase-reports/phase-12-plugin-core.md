# Phase 12 驗證報告：Plugin Core

- 日期：2026-10-23
- 目前版本：`1.2.4`（未修改）
- 階段狀態：Plugin Core 實作完成；source gates 通過；依賴稽核回報兩項既有 High 漏洞，P12.2/P12.3 的 Electron 手動驗收未驗證；等待複檢。
- 建議版本：`1.3.0`（Phase 12–16 整體 minor 建議；本階段不改版）

## 範圍與實作摘要

本階段新增插件契約與 manifest 驗證、通用 ZIP 防護、泡泡仲裁純函式、插件 feed controller 與偏好儲存。沒有執行任何第三方插件程式碼，也沒有新增 IPC/API 接線供插件呼叫。

- P12.1：`src/types/plugin.ts`、`electron/plugin-manifest.ts` 與正反向 manifest 測試。
- P12.2：`electron/archive-guard.ts`、ZIP 安全測試；`electron/main.ts` 的 `import-pet-zip` 改用共用防護器，維持既有寵物 ZIP 大小與檔案上限。
- P12.3：`src/utils/feed-arbiter.ts`、優先順序測試；`src/components/DesktopPet.vue` 使用純函式選擇既有泡泡候選。
- P12.4：`electron/plugin-feed.ts`、`electron/plugin-preferences.ts` 及測試；feed 輸入、通知狀態和資源偏好均有界，偏好檔存於 Electron `userData`。

## Checkpoint

| Checkpoint | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P12.1 | 插件型別與 manifest 驗證 | `9a2e61650531461f3f73ffcf74381c42e65bf938` | 四項 §0.4 檢查通過；已推送 |
| P12.2 | 共用 archive guard 與寵物 ZIP 匯入接線 | `a268d02208f5af2f804b5aae498eddcaf270d7db` | 四項 §0.4 檢查通過；已推送；手動 ZIP 匯入未驗證 |
| P12.3 | 泡泡仲裁純函式與 DesktopPet 接線 | `efaa097e72695febc84df080621bb403ebf66def` | 四項 §0.4 檢查通過；已推送；手動泡泡驗收未驗證 |
| P12.4 | PluginFeedController 與偏好管理 | `c92825a` | 四項 §0.4 檢查通過（185/185）；已推送 |
| P12.5 | Phase report、安全審查與最終驗證 | 本報告所在 checkpoint commit；完整 SHA 於最終回報提供 | §0.4 通過；依賴稽核有兩項 High；Electron 手動驗收仍未驗證 |

## 驗收條件

| 驗收條件 | 結果 | 證據／限制 |
|---|---|---|
| 使用者可見行為與 Phase 12 前完全相同（泡泡、寵物匯入） | 未驗證 | 原有條件已保留並由仲裁測試覆蓋；未在 `pnpm dev` 實際匯入 ZIP 或操作泡泡。handoff 的 Agent toast / Presentation say 同時候選順序與舊模板不同，詳見待決問題。 |
| manifest、archive-guard、feed-arbiter、plugin-feed、plugin-preferences 都有正反向測試且通過 | 通過 | `pnpm test:unit` 最終 185/185；各 checkpoint 的測試數見下方。 |
| 新純模組沒有 import `electron` | 通過 | 檢查 `electron/plugin-manifest.ts`、`electron/archive-guard.ts`、`electron/plugin-feed.ts`、`electron/plugin-preferences.ts`、`src/utils/feed-arbiter.ts`，未發現 `electron` import。 |
| 沒有新增 runtime 相依、沒有改版本號 | 通過 | `package.json` 版本仍為 `1.2.4`；`package.json`、`pnpm-lock.yaml` 在 Phase 12 diff 中均未變。 |

## §0.4 驗證 gates

| 實際指令 | P12.1 | P12.2 | P12.3 | P12.4 | P12.5 |
|---|---|---|---|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 | 通過 | 通過 | 通過 | 通過 |
| `pnpm test:unit` | 通過，133/133 | 通過，140/140 | 通過，164/164 | 通過，185/185 | 通過，185/185 |
| `pnpm exec vite build` | 通過 | 通過 | 通過 | 通過 | 通過；renderer 84、main 86、preload 2 modules |
| `git diff --check` | 通過 | 通過 | 通過 | 通過 | 通過 |

P12.4 亦執行 staged diff check。P12.1–P12.4 各 checkpoint commit 均推送至 `origin/feat/plugin-host`；P12.5 最終 checkpoint 會隨本報告提交並推送。

## 安全檢查

- **依賴稽核：未通過。** `pnpm audit --prod --audit-level moderate` 依 lockfile 回報兩項既有 High 弱點：
  - `source-map-js`，受影響版本 `<1.2.2`，修補版本 `>=1.2.2`，GHSA-68fv-2mgg-jv7q。
  - `@vue/server-renderer`，受影響版本 `<3.5.42`，修補版本 `>=3.5.42`，GHSA-g2v6-rqmx-r4w6。
  Phase 12 未變更依賴；需要在後續確認升級相容性並更新鎖定版本。
- **高風險 secret scan：通過。** 對追蹤檔案執行隱藏檔掃描，排除 `.git/`、`.claude/`、依賴、建置與 release 產物；私鑰、常見 GitHub/OpenAI/Slack token、AWS access key 與 Google API key 模式均未命中。公開 OAuth client ID 不列為憑證。
- **IPC 與 least privilege：通過。** Phase 12 沒有新增插件 IPC 或 preload API。變更的 `import-pet-zip` handler 仍先呼叫 `assertTrustedIpcSender(event, panelWindow)`，由系統檔案選擇器取得 ZIP，然後才交給 archive guard。
- **ZIP 與檔案系統：通過 source review。** archive guard 在 `fflate` 解壓時先檢查路徑、重複路徑、檔案數和 `originalSize`，解壓後再比對實際大小；拒絕絕對/磁碟/反斜線/`..` 路徑。偏好讀取重用 `readBoundedJson`（regular file、拒絕 symlink、大小上限），寫入重用 `writeJsonAtomic`（原子替換、POSIX 權限 `0600`）。偏好檔額外採 1 MiB 上限。
- **插件輸入與通知：通過 source review。** feed 僅接受 schema allowlist、純文字長度上限、`low`/`normal`、1–15 秒 TTL；連結需 HTTPS、無 credential/非標準 port、通過公開 DNS host 與插件授權 callback。全域/單插件開關、DND、靜音、限流、去重、佇列和通知中心均有明確界限。圖示僅接受 resolver 產生的宿主 `agent-pets://plugin/<id>/...` URL，未提供 resolver 時拒絕。
- **敏感資料／UI：通過 source review。** 新模組不記錄 token、密鑰或工具參數；通知使用 presentation 的純文字淨化，不引入 `v-html`、系統通知或 UI 對話框。Phase 12 未新增視覺元件或樣式。
- **Local server、Permission Broker、MCP：不適用。** 本階段沒有修改本機 server、Permission Broker 或 MCP 能力。
- **版本與受保護目錄：通過。** 版本為 `1.2.4`，`package.json` 與 `pnpm-lock.yaml` 未變；Phase 12 diff 未觸及 `.claude/`。
- **第三方程式碼：未執行。** 本階段交付純模組和測試，沒有啟動或載入任何第三方插件。

## Electron 手動驗證

以下驗收均未驗證；沒有把單元測試或 Vite build 當作實際 Electron 操作結果：

| 項目 | `pnpm dev` 實際操作與結果 |
|---|---|
| P12.2 寵物 ZIP 匯入 | 未執行。未在 Electron 視窗選取並匯入測試寵物 ZIP。 |
| P12.3 權限請求、完成 toast、MCP `pet_say`、activity | 未執行。未在 Electron 視窗觸發或觀察這四種泡泡。 |

目前工具環境不能操作原生 Electron 視窗；Vite build 僅驗證編譯。此工作站為 macOS x86_64，但沒有完成原生 UI smoke test；Windows/Linux 尚未驗證。

## 殘餘風險與待決問題

1. 依賴稽核發現的兩項既有 High 弱點尚未修補；請複檢時決定後續依賴升級範圍。
2. P12.2 ZIP 匯入及 P12.3 四種泡泡的 Electron 手動驗收待補；跨平台原生行為也尚未驗證。
3. handoff 未指定低階同順位順序；目前固定為 activity 先於 plugin feed（low），請確認此 tie-break。
4. handoff 明定 Agent timed toast 高於 Presentation MCP say，但 Phase 12 前的 `v-if` 鏈在兩者同時存在時是 Presentation say 先顯示。此實作遵循 handoff 優先序；請確認是否接受這項重疊情境的可見行為差異。
5. handoff 未指定偏好 JSON 大小，本實作採 1 MiB 並在超限時回到插件停用預設；請確認此上限。
6. P12.1 對未明定的 settings schema 邊界採保守上限（property key 64 字元、enum 50 項、字串 4096 字元、enum 顯示文字 256 字元、secret 欄位拒絕 default）；P12.2 另限制 archive path 512 字元並拒絕 Windows 禁用字元。請複檢這些額外契約限制。
7. `targetPetId` 採 ASCII 安全 ID allowlist（1–64 字元且拒絕 `..`），feed 圖示需由宿主 resolver 轉成 `agent-pets://plugin/<id>/...`；請在 P13 接線時確認實際寵物 ID 與 protocol resolver 契約相容。

## 文件同步

本階段未更新兩份 README：插件安裝、執行與設定 UI 尚未實作或啟用，Phase 12 的契約已有 `docs/architecture/Plugin-System-Plan.zh-TW.md` 與 handoff 規格記載；README 目前沒有向使用者宣稱插件宿主已可用。本報告記錄本階段的實作與限制。
