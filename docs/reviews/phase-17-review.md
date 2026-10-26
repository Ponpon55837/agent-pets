# Phase 17 複檢（P17.0–P17.5）

- 複檢對象：`feat/plugin-distribution` 的 `6adf8e3..a420a74`
- 複檢日期：2026-10-26
- 結論：**P17.0–P17.4 功能正確，需修正 R1–R2 兩項與交接不一致的地方（R3–R4 為低優先）。eventSource 威脅模型通過，下方「P17.6 實作決策」為正式契約，修完 R1–R4 後可直接接著做 P17.6–P17.7。**

## 複檢時實際執行

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 369/369 |
| `pnpm exec vite build`、`pnpm check:bundle` | 通過 |
| `git diff --check 6adf8e3..HEAD` | 通過 |
| `pnpm audit --prod --audit-level moderate` | 無弱點 |
| 私鑰／token／本機路徑掃描（新增差異與所有追蹤檔案） | 0 命中 |

### Electron 實機（隔離啟動腳本；safeStorage 呼叫次數全程 0；不連外網，目錄與下載皆由 `catalogFixture` 提供）

測試套件由複檢者以 `node:crypto` 即時產生兩把 ed25519 金鑰簽章（金鑰只存在記憶體，未寫入 repo）。

| 項目 | 結果 |
|---|---|
| 線上目錄關閉時讀取目錄 | `catalog_disabled` ✅ |
| 開啟並設定目錄網址後讀取 | 正確列出插件、版本、指紋 ✅ |
| 本機安裝簽章後被竄改的套件 | `signature_invalid` ✅ |
| 目錄下載內容與 `sha256` 不符 | `download_mismatch` ✅ |
| 從目錄安裝已簽章插件 | 簽章 `valid`、指紋正確、`first-trust`、來源 `catalog` ✅ |
| 檢查更新 | 列出 1.0.0 → 1.0.1、金鑰未變；從目錄更新成功，不需額外確認 ✅ |
| 換金鑰的新版本 | `key-changed`；未確認時回 `signature_confirmation_required`，確認後才安裝 ✅ |
| 換金鑰後再從目錄裝舊金鑰的版本 | 標示為降版且 `key-changed`，需確認 ✅ |
| 回報問題 | 攔截到 `https://github.com/<repo>/issues/new?title=%5Bok-signed%5D+1.0.2`，只帶 id 與版本 ✅ |
| 設定 ▸ 插件畫面 | 線上目錄開關、網址、檢查更新、每日檢查、簽章狀態與指紋正常顯示 ✅ |

## 修正清單 R1–R4

### R1（中）目錄網址沒有預設值

- 現況：`catalogUrl` 預設是空字串，使用者開啟線上目錄後還要自己找網址貼上。
- 交接決策：預設為 `https://raw.githubusercontent.com/Ponpon55837/agent-pets-plugins/main/index.json`。
- 修正：預設值改為上述網址；保留可編輯（host 仍限制在允許清單內），並加「恢復預設」按鈕。開關仍預設關閉，開啟前不連線。補測試。

### R2（中）回報網址改成固定值

- 現況：正式版從環境變數 `AGENT_PETS_PLUGIN_ISSUE_REPORT_URL` 讀取，沒設定時回 `report_unavailable`，所以正式版的回報按鈕實際上不能用。
- 交接決策：網址由宿主固定組成。
- 修正：移除環境變數，正式版固定使用 `https://github.com/Ponpon55837/agent-pets-plugins/issues/new`；隔離測試仍可用 `__agentPetsE2E.pluginIssueReportBaseUrl` 覆寫。文件 `reporting` 中英文同步。補測試。

### R3（低）停用的插件圖示破圖

- 現況（Phase 13 起就有）：`agent-pets://plugin/<id>/...` 只提供 **已啟用** 插件的檔案，剛安裝（預設停用）的插件在列表中圖示是破圖。
- 修正：插件列表的圖示改走只允許 manifest `icon` 那一個檔案、且檔案通過 `isSupportedRasterImage` 的專用路徑（不論啟用與否）；或載入失敗時顯示預設圖示。不要因此放寬其他檔案的存取。

### R4（低）更新清單的「權限是否增加」

- 現況：下載前 `permissionsIncreased` 為 `null`。
- 修正：介面上 `null` 要顯示「下載後確認」之類的文字，不要顯示成「沒有增加」。確認現有 UI 行為，必要時補上。

## P17.6 實作決策（威脅模型複檢結果，作為正式契約）

1. **狀態與 session：** 照威脅模型。只接受 `{ sessionId, state }`，state 限 `thinking`、`tool-running`、`idle`、`done`、`error`。`done`／`error` 是終態，同一個 sessionId 之後再送事件回 `invalid_request`，要開新 session 就用新的 id。`done` 只是顯示用的終態，不轉換成內建的 `success`。
2. **family 保留字：** 照威脅模型的清單，另外加上 `generic-http`、`agent-pets`、`plugin`、`system`。比對前先轉小寫，並把 `_`、空白、`.` 正規化成 `-`。
3. **上限：** 照威脅模型的建議值，定為公開契約：
   - 速率：每插件每 60 秒 30 次、全域 120 次；
   - session 數：每插件 20 個、全域 100 個；
   - 大小：每筆事件 2 KiB、sessionId 64 bytes、顯示名稱 80 個字元；
   - 存活時間：活躍狀態閒置 2 分鐘清除、`done`／`error` 保留 30 秒、單一 session 最長 30 分鐘。

   數值要寫進 `limits` 文件。
4. **Generic HTTP：** 不需修改。它是必須帶 `x-agent-pets-token` 的本機 loopback 入口（沒帶 token 回 401），會產生 XP／History 是給受信任本機客戶端的既有產品行為。eventSource 不得共用這個入口，照威脅模型使用獨立的 IPC、型別、store 與 renderer 通道。
5. **必要測試：** 照威脅模型「P17.6 實作閘門」第 5 點，用 spy 證明 Permission、XP、成就、History、quota、通知、Agent event pipeline 呼叫次數都是 0；停用、移除、崩潰、reload 時會清除狀態與限流記錄；停用前已排隊的事件在清除後不能再寫入。
6. **UI：** 插件狀態列固定顯示「來自插件：<插件名稱>」，不能和內建 Agent 的狀態列合併或替換。

## 已知、不阻擋

- 建立 `Ponpon55837/agent-pets-plugins` repo 是使用者的工作；在那之前，預設目錄網址會回 404，介面要顯示可理解的錯誤，而不是空白。
