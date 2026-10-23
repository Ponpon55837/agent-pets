# Phase 15 驗證報告：自訂面板頁（panelView）

- 日期：2026-10-23
- 目前版本：`1.2.4`（未修改）
- 階段狀態：P15.0–P15.4 原始 checkpoint 已完成；P15.R 程式與隔離 Electron 實測通過。推送因本機僅有鑰匙圈認證而依安全限制暫未完成。
- 建議版本：`1.3.0`（Phase 12–16 整體建議 minor；本階段未改版）

## 範圍與結果

- P15.0 先新增 panelView 威脅模型，再開始實作。
- P15.1 使用獨立 sandboxed `WebContentsView`、每插件非持久 partition、隨機權杖資源路徑與受限 preload。只放行同插件資源及唯讀 `_shared/tokens.css`；拒絕外連、導覽、彈窗、下載、權限與拖放。面板 API 不含 `secrets.get`、`net.requestHost`。
- P15.2 加入宿主外框、尺寸偏好、泡泡入口及面板切換／還原。
- P15.3 加入同插件 Worker 與頁面的 JSON 雙向訊息、256 KB 大小限制、每方向每秒 20 則限制；面板關閉時不排隊。
- P15.4 新增雙語 panel-view 指南、索引、API 型別、schema 說明、`panel-demo`、`ok-panel`、`evil-panel` 及對應測試；補上 dark/high-contrast/forced-colors/reduced-motion 樣式。
- 未修改版本號、`.claude/`、runtime dependencies；未執行 `pnpm build`。

## Checkpoints

| Checkpoint | 內容 | Commit | 結果 |
|---|---|---|---|
| P15.0 | panelView 威脅模型 | `83baefc0f63d3a42a7619338a38cd886e24d65ef` | 已提交並推送 |
| P15.1 | 隔離 WebContentsView 與安全資源載入 | `42ce5dcaedda6e303ac6eccd0ac1e947f99d7c59` | source tests 通過 |
| P15.2 | 外框、尺寸控制與泡泡入口 | `ef80789166e8df0589df2fc352982fb83e30205a` | source tests 通過 |
| P15.3 | 面板與 Worker 雙向訊息 | `faeaee5c6161f8ba4f4cceaf6dae9591718914b0` | source tests 通過，unit 288/288 |
| P15.4 | panel-view 文件、範例與安全探針 | `7085e5da66e9bec50d757f4d97264eba90c678eb` | source gates 通過；Electron 實機項目未驗證 |

## Acceptance criteria

| 驗收項目 | 結果 |
|---|---|
| 面板使用獨立 WebContentsView、sandbox、非持久 plugin partition 與隨機權杖路徑 | 實作及單元測試通過；Electron 執行時未驗證 |
| 只載入同插件檔案與 `_shared/tokens.css`；拒絕網路、導覽、彈窗、下載、權限、拖放 | policy 單元測試通過；`evil-panel` 已加入 fetch/XHR/WebSocket、跨權杖檔案、導覽、彈窗、下載、權限與拖放探針；實機結果未驗證 |
| preload 不提供 `secrets.get` 與 `net.requestHost` | bridge 單元測試及面板 API 型別文件測試通過 |
| 外框位於 WebContentsView 外、泡泡可開啟面板、preferredSize 有界且可還原 | P15.2 source tests 通過；實際視窗遮蓋、縮放與切頁效果未驗證 |
| Worker/page 訊息僅限同插件、JSON、256 KB、每方向每秒 20 則，關閉面板不排隊 | unit tests 通過 |
| `ok-panel`、`evil-panel` 與 `panel-demo` 可在隔離 Electron 運作 | fixture、manifest 與文件 contract tests 通過；Electron 載入及操作未驗證 |
| 深淺色、高對比、reduced motion 下外框可用 | 對應 CSS 已實作；視覺實機驗收未驗證 |

## 驗證 gates

| 指令 | 實際結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 通過，291/291 |
| `pnpm exec vite build` | 通過，renderer、main、preload、plugin-host-preload、plugin-ui-preload 均產出 |
| `git diff --check` 與 `git diff --cached --check` | 通過 |
| targeted plugin fixture/public-docs tests | 通過，19/19 |
| `pnpm audit --prod --audit-level moderate` | `No known vulnerabilities found` |
| Secret pattern scan | Phase 12 起 49 個已提交 commit 與本報告暫存差異均已掃描；未命中私鑰、GitHub/OpenAI/Slack token、AWS key、Google API key 或本機絕對路徑。兩筆郵件樣式字串只使用保留範例網域；P15.4 程式差異與本報告未命中。 |
| `pnpm build` | 未執行，依要求 |

## Electron 實機驗證

已嘗試以臨時環境啟動 `pnpm dev`，但 Electron 回報的 `app.getPath('userData')` 不在預期的臨時目錄。Inspector 接上後曾替換 safeStorage 為可逆假實作並確認 round-trip；然而替換發生在 App 啟動後，無法證明啟動前沒有使用原始 safeStorage。沒有安裝或啟用本階段測試插件，沒有執行 secrets 測試，也沒有可證明 Keychain 是否曾被觸發的觀察。該程序已停止。

後續預備以啟動前已驗證隔離的方式重試時，自動審查拒絕了 Electron 啟動，理由是既有隔離檢查失敗後仍可能觸碰使用者資料或鑰匙圈；依審查要求沒有改用其他啟動方式繞過。因此以下皆標示「未驗證」：

- `ok-panel` 的 storage 顯示與 Worker ↔ page 訊息。
- `panel-demo` 的 storage 讀回、按鈕操作與 Worker 回覆。
- `evil-panel` 的 direct fetch、XHR、WebSocket、跨權杖檔案、window.open、導覽、父視窗存取、下載、media/geolocation 權限與拖放是否在實際 Electron 中全數失敗。
- 假權限確認畫面是否無法遮住宿主外框。
- 深色／淺色、高對比、reduced motion 與面板 resize 的實際視覺結果。
- 本次早期啟動是否使用原始 safeStorage 或觸發 macOS Keychain；目前無法證明未觸發。

## 手動驗收步驟

1. 執行 `pnpm exec vite build`，再執行 `node scripts/e2e-isolated-electron.mjs`。只有看到 `AGENT_PETS_E2E_READY` 且 `fakeSafeStorage: true` 才繼續；確認 userData 與 HOME 位於暫存 root，記錄開始時的 `globalThis.__agentPetsE2E.calls`。任一條件不符就停止。
2. 在設定面板安裝 `docs/plugins/examples/panel-demo/` 並開啟。預期讀回 storage 計數；按鈕操作後 Worker 寫入並回覆，面板更新計數。
3. 安裝 `tests/fixtures/plugins/ok-panel/`。預期面板顯示 Worker 寫入的 storage 資料，頁面與 Worker 訊息往返成功。
4. 安裝 `tests/fixtures/plugins/evil-panel/`，於 panel renderer 呼叫 `window.runPanelSecurityProbes()`。預期 direct fetch、XHR、WebSocket、其他插件檔案、window.open、外站導覽與權限探測失敗；`window.parent`／`window.top` 指向自身；仿冒權限框只出現在內容區。
5. 以 CDP 監看外站 iframe 的 Network 與 CSP。預期 `frame-src 'none'` 在網路請求送出前阻擋，沒有 `Network.requestWillBeSent` 或 `Network.responseReceived`。以 `Input.dispatchDragEvent` 拖放隔離暫存文字檔，預期 drop 事件與檔案數都是 0；觸發下載後，暫存 root 不應出現下載檔。
6. 比較宿主 frame、標題列和關閉鈕 bounds 與 plugin WebContentsView bounds。預期子視圖位於外框內容區內、標題列在其上方；仿冒畫面不得遮住宿主控制。
7. 以 CDP 分別模擬 light、dark、high contrast／forced colors、reduced motion，截圖檢查外框文字、邊界、焦點與關閉鈕。預期四種模式都可辨識，reduced motion 不播放過場。
8. 關閉插件面板後，從可信面板 renderer 以零寬或零高 bounds 呼叫 `openPluginPanelView`。預期回傳 `panel_unavailable`、視窗不 resize、沒有建立 WebContentsView。再開啟面板並 crash 子 renderer；預期外框收起並顯示錯誤。快速關閉舊頁再開新頁時，舊 close event 不得關掉新頁。
9. 不呼叫 `secrets`，也不呼叫真實相機、麥克風、定位或螢幕錄影 API。若另做 secrets 測試，必須先按 §0.4a 在主程序替換並驗證 fake safeStorage。結束後只在啟動隔離腳本的 terminal 按 Ctrl+C，確認程序停止，再記錄結束時 `calls`。



## 安全檢查與待決問題

- 新增面板載入仍採同插件隨機權杖資源路徑；session 的 URL allowlist、GET 限制、permission denial、download cancellation、navigation denial 與 preload API 子集有對應單元測試。
- `pnpm audit` 無已知 production dependency 漏洞；本階段沒有新增 runtime dependency。
- 由於自動審查阻止安全隔離未確認的 Electron 重啟，P15.4 的真實視窗攻擊與視覺驗收未完成。需要在可驗證的隔離環境完成上方手動清單後，才能將 Phase 15 標記為實機驗收通過。
- 首次啟動時 safeStorage 假實作並非在 Electron 入口前套用，且實際 userData 未落在臨時目錄；雖沒有安裝或啟用測試插件，仍無法排除原有啟動流程曾呼叫原始 safeStorage 或觸發 Keychain。此項保持未驗證，不應視為已證明 Keychain 未被觸碰。
- Windows/Linux 尚無實機驗收證據。

## 複檢修正（P15.R）

- 日期：2026-10-23。
- P1–P4 程式與測試變更 commit：`06958078271c899d060737f1c438806f432a8d58`；下表各列均指此 commit。
- `preferredSize` 在 P15.2 已存在，不是本次新增：插件可於 manifest 設定建議寬高，宿主限制寬 320–960、高 240–800 px，並依螢幕工作區裁切。實測 evil-panel 以 520×440 開啟，關閉後還原至 460×720。插件不能在執行中移動或縮放；目前沒有插件自行全螢幕的 API。

### P1–P4 修正與測試

| 項目 | 修正內容 | Commit | 新增／補強測試與實機結果 |
|---|---|---|---|
| P1 | `tokens.css` 改為建置時嵌入 Electron main bundle，不再從打包後不存在的 `src/` 路徑讀取。 | `06958078271c899d060737f1c438806f432a8d58` | 新增 `scripts/check-plugin-panel-tokens-bundle.mjs`；build 後檢查 `dist-electron/main.js` 含 token 樣式標記，通過。 |
| P2 | 關閉事件帶 `pluginId`、遞增 `openToken` 與原因；主程序在關閉、載入失敗、銷毀或 renderer crash 時通知宿主。Renderer 忽略過期事件。 | `06958078271c899d060737f1c438806f432a8d58` | 補強 `tests/plugin-panel-view.test.mts` 的快速 close/open、load failure、crash/destroy；新增 `tests/plugin-panel-view-ui.test.mts` 測過期事件。隔離 Electron 實際 crash 後外框消失並顯示錯誤。 |
| P3 | 主程序先驗證 frame/content bounds 位於可信宿主視窗內，只有有效 bounds 才調整尺寸與建立／附加 WebContentsView。 | `06958078271c899d060737f1c438806f432a8d58` | 補強 `tests/plugin-panel-view.test.mts` 的無效 bounds 不建 view 測試。實機零寬 bounds 回 `panel_unavailable`；視窗維持 460×720，子視圖數為 0。 |
| P4 | evil-panel 加入外站 iframe、拖放、下載與仿冒權限畫面探測；改用不會彈系統視窗的 camera/geolocation `permissions.query` 和 `Notification.requestPermission`，移除真實相機、麥克風、定位呼叫。 | `06958078271c899d060737f1c438806f432a8d58` | 補強 `tests/plugin-fixtures.test.mts` 確認攻擊探測且不含真實感測器 API。實機：CSP 阻擋 iframe／連線，拖放 0 事件、下載未落地，仿冒框不能蓋住宿主外框。 |

### §0.4 與 §0.4b 檢查

| 檢查 | 實際結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過。 |
| `pnpm test:unit` | 通過，296/296。 |
| `pnpm exec vite build` | 通過；renderer、main、preload、plugin-host-preload、plugin-ui-preload 均產出。未執行 `pnpm build`。 |
| `git diff --check` | 通過。 |
| P1 bundle assertion | `node scripts/check-plugin-panel-tokens-bundle.mjs` 通過。 |
| `pnpm audit --prod --audit-level moderate` | `No known vulnerabilities found`。 |
| Secret／個資 pattern scan | 掃描 Phase 12 起 52 個 commit 範圍與本次差異；沒有私鑰、GitHub／OpenAI／Slack token、AWS key、Google API key 或本機絕對路徑。兩個 email-like 命中位於合成測試 URL，使用保留的 `example.com` 網域，屬範例字串，非真實個資。 |

### 隔離 Electron 實測

- 只使用 `node scripts/e2e-isolated-electron.mjs` 啟動；看到 `AGENT_PETS_E2E_READY`，`fakeSafeStorage: true` 及暫存 userData/HOME 驗證成功後才載入插件。未使用 `pnpm dev`，沒有觸發鑰匙圈。
- safeStorage 計數開始／結束均為 `{ isEncryptionAvailable: 0, encryptString: 0, decryptString: 0 }`。本次未執行 secrets 操作，也未呼叫真實相機、麥克風、定位或螢幕錄影 API。
- evil-panel 的 `window.runPanelSecurityProbes()` 顯示 secrets/requestHost 未暴露；direct fetch、XHR、WebSocket、跨插件檔案、window.open、導覽均被阻擋；camera/geolocation/notification 權限為 denied；仿冒對話框可在插件內容區繪出。
- iframe：reload 時 CDP 看到 `frame-src 'none'` CSP 訊息；該 iframe 無 `Network.requestWillBeSent`、無 `Network.responseReceived`。主程序 `webRequest.onBeforeRequest` 計數為 0，因 CSP 在網路層前阻擋。probe 中對 example.com 的 fetch 亦因 `connect-src 'none'` 失敗。
- 拖放：CDP `Input.dispatchDragEvent` 後 drop event 數 0、檔案數 0、頁面仍在原插件 URL。下載探測已執行；隔離 root 中沒有 `evil-panel-download.html`。
- 宿主 frame 約 485×229，內容 WebContentsView 約 483×175 且位於標題列下方。淺色、深色、高對比／forced colors、reduced motion 截圖中宿主標題、外框與關閉鈕都可見；另截取的子視圖顯示仿冒框只佔內容區，不能蓋住宿主控制列。
- Renderer crash 後收到關閉事件，宿主收起外框並顯示「插件面板發生錯誤，已關閉。」；無效 bounds 回 `panel_unavailable` 且沒有 resize 或子視圖。

### 未驗證與待處理

- 本次沒有驗證 Windows/Linux，沒有呼叫真實硬體或系統權限 API（依規則刻意避免）；此前錯誤隔離啟動的歷史結果仍無法回溯證明當時是否使用原始 safeStorage，維持未驗證。
- 本次確認 preferredSize 尺寸與關閉後還原；未重新測試使用者手動拖曳調整 native 面板尺寸的優先順序。開發者不能執行中任意變更 bounds；若需要真正全螢幕顯示，需另訂宿主控制且保留外框的設計。
- 推送尚未完成：為遵守不得觸碰本機鑰匙圈，push 時停用全域 `osxkeychain` helper，Git 回報無可用密碼；沒有使用鑰匙圈。`feat/plugin-host` 有本地 commit 未推送，需要可用的非鑰匙圈認證路徑後才能同步。
