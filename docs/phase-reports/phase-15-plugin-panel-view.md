# Phase 15 驗證報告：自訂面板頁（panelView）

- 日期：2026-10-23
- 目前版本：`1.2.4`（未修改）
- 階段狀態：P15.0–P15.4 的程式、文件與 source gates 已完成；必要的 Electron 實機驗收受隔離安全檢查阻擋，Phase 15 尚未實機驗收通過。
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

請使用新的臨時 HOME 與 userData，不要使用已安裝 App 或既有個人設定。每次先確認 Electron 回報的 `app.getPath('userData')` 確實位於該臨時目錄；若不相符，立即關閉並停止驗收，不要安裝插件。若測試任何 secrets 行為，必須先在主程序替換 safeStorage 為 §0.4a 的可逆假實作並確認 round-trip，再安裝或啟用插件。

1. 執行 `pnpm exec vite build`。建立全新的臨時 `home/`、`ud/`，以 §0.4a 的 Electron 命令啟動並傳入明確的 `--user-data-dir=<tmp>/ud`、Inspector 與 remote-debugging port。連接 Inspector 後先核對實際 userData 路徑；不相符就停止。
2. 將 `docs/plugins/examples/panel-demo/` 內容打包成 ZIP，副檔名改為 `.agentpet-plugin`，ZIP 根目錄需直接包含 `plugin.json`、`dist/main.js`、`ui/` 與 `assets/`。使用設定面板安裝並同意 storage 權限。
   - 預期：開啟「範例面板」後顯示儲存的計數；按一次按鈕後 Worker 寫入 storage 並回覆，新計數立即顯示。
3. 以相同方式打包並安裝 `tests/fixtures/plugins/ok-panel/`。
   - 預期：面板顯示 Worker 寫入的 storage 內容；按「Send」後面板收到 Worker 的 pong。
4. 打包並安裝 `tests/fixtures/plugins/evil-panel/`，在該 panel renderer 執行 `window.runPanelSecurityProbes()`，查看回傳值與插件 log。
   - 預期：fetch、XHR、WebSocket、外站導覽及跨權杖檔案讀取不成功；`window.open` 回傳 null；導覽後仍停在原插件頁；`window.parent`／`window.top` 都是面板自身且看不到宿主 DOM；media/geolocation 權限遭拒；drop event 被阻止；下載不產生檔案。
   - 預期：頁面可顯示仿造權限對話框，但它只在 WebContentsView 內容範圍內；宿主繪製的插件名稱、圖示、「Plugin content」標記和關閉按鈕始終可見且可操作。
5. 調整面板大小並切換插件分頁，再切回面板頁。
   - 預期：WebContentsView bounds 貼合外框內部；面板頁偏好尺寸不超出螢幕工作區；切頁後恢復原面板尺寸。
6. 分別切換 light/dark、high contrast/forced colors、reduced motion 後檢查外框、文字、邊界與關閉按鈕。
   - 預期：外框與控制項仍可辨識、聚焦輪廓可見；reduced motion 不播放過場。
7. 完成後透過該隔離 App 的 Inspector 執行 `app.quit()`，確認該程序停止，再刪除臨時測試資料。不得終止其他 Agent Pets 或 Electron 程序。

## 安全檢查與待決問題

- 新增面板載入仍採同插件隨機權杖資源路徑；session 的 URL allowlist、GET 限制、permission denial、download cancellation、navigation denial 與 preload API 子集有對應單元測試。
- `pnpm audit` 無已知 production dependency 漏洞；本階段沒有新增 runtime dependency。
- 由於自動審查阻止安全隔離未確認的 Electron 重啟，P15.4 的真實視窗攻擊與視覺驗收未完成。需要在可驗證的隔離環境完成上方手動清單後，才能將 Phase 15 標記為實機驗收通過。
- 首次啟動時 safeStorage 假實作並非在 Electron 入口前套用，且實際 userData 未落在臨時目錄；雖沒有安裝或啟用測試插件，仍無法排除原有啟動流程曾呼叫原始 safeStorage 或觸發 Keychain。此項保持未驗證，不應視為已證明 Keychain 未被觸碰。
- Windows/Linux 尚無實機驗收證據。
