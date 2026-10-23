# Phase 14 驗收報告：插件網路、密鑰、設定、排程與 Agent 狀態

- 日期：2026-10-23
- 目前版本：`1.2.4`（未修改）
- 階段狀態：P14.1–P14.6 實作完成；各 checkpoint 的 §0.4 四項檢查通過並已推送。隔離 Electron 已驗證多條真實 Host API 路徑；密鑰加密、外部 redirect 來源及真實 Agent adapter 仍有明確未驗證項目。
- 建議版本：`1.3.0`（Phase 12–16 整體 minor 建議；本階段不改版）
- 分支：`feat/plugin-host`
- `origin/main`：`package.json` 的 Vue 為 `^3.5.44`。`git merge origin/main` 回報 `Already up to date`；主線已在本分支祖先中，沒有新增 merge commit，也沒有合併到 main。

## 範圍與結果

完成 P14.1–P14.6：插件網路代理與逐跳 URL／DNS／IP 檢查、執行時網域申請、密鑰與非密鑰設定儲存、排程與 Agent 狀態 API、每插件偏好與資源上限、開發者資料夾載入與自動重載，以及雙語第三方開發者文件、JSON Schema、TypeScript declarations 和範例。`net.fetch` 及其他新 Host API 維持成功直接回傳值、失敗丟出帶 `code` 的 Error。

P14.6 收尾修正兩項實測發現：bootstrap 不再把選填的 `undefined` 序列化進 `pet.react`／`net.fetch` RPC；入門教學改把套件輸出到監看資料夾的上一層，避免開發者監看器把套件本身當作來源變更。新增對應測試。未執行 `pnpm build`，未改版本、runtime dependency 或 `.claude/`。

## Checkpoint

| Checkpoint | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P14.1 | HTTPS 網路代理、host/DNS/IP 安全檢查、redirect 與大小／逾時／速率限制 | `aa56c0f8ef3f80fb725848919db9c6765a849707` | §0.4 通過；單元測試 240/240；已推送 |
| P14.2 | `net.requestHost` 同意、拒絕冷卻、申請限流與撤銷 | `0b5a6b35e12399eb94eff4c373e6c2683f2722c1` | §0.4 通過；單元測試 246/246；已推送 |
| P14.3 | `safeStorage` 密鑰服務與 settings schema／表單 | `65968214a23bd788f6c5583a2a78b6df5e1ede17` | §0.4 通過；單元測試 254/254；已推送 |
| P14.4 | `schedule.every`、`pet.status`／`onStatusChange` 及安全狀態投影 | `796926aab5135b3771ace75829f72d0d9f028574`、`b679a7d5f2acc61560f2ba4a2a1b6f2f2296b06a` | §0.4 通過；最後一個 checkpoint 單元測試 260/260；已推送 |
| P14.5 | 每插件通知偏好、授權網域、寵物目標與進階資源上限 | `00cbf90b6ba6179b27199db4f87b8142805afe48` | §0.4 通過；單元測試 260/260；已推送 |
| P14.6 | 開發者模式、雙語文件與範例；選填 RPC 參數及打包教學修正 | `554d27d1fd98d259e030024984a128416257b416`、`63e961386759b7d4d97860909d7d6768aafced64`；驗收報告隨最終 checkpoint commit 推送 | 最終 §0.4 通過；單元測試 270/270；已推送 |

P14.4 有兩個依序推送的 commit，用於補齊淨化狀態中的 Agent family。P14.6 最終報告 commit 的 SHA 由 Git HEAD／最終回報提供，避免在報告內自我引用。

## §0.4 檢查結果

| 最終 P14.6 指令 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm test:unit` | 通過，270/270；0 失敗、0 略過 |
| `pnpm exec vite build` | 通過；renderer、Electron main、preload 與 plugin-host preload 均建置成功 |
| `git diff --check` | 通過 |

P14.1–P14.6 各 checkpoint 均依序通過相同四項檢查後才 commit、push。最終 P14.6 修正 commit `63e9613` 的完整檢查結果如上。沒有執行 `pnpm build`。

## Phase 14 驗收條件

| 驗收條件 | 結果 | 證據與限制 |
|---|---|---|
| manifest host 可 fetch；未宣告 host、HTTP、IP、localhost、私有網段及 redirect 私有目標都阻擋 | 部分隔離 Electron 驗證；純模組測試通過 | Electron 中 `api.github.com` 請求收到 HTTP 404，證明請求完成並取得 HTTP 回應；未宣告 host、HTTP、公開 IP literal、localhost、私有 IP 均記錄 `host_not_allowed`。外部 `httpbin.org` redirect source 在此環境不可達；透過 CDP 注入 302 `Location: https://127.0.0.1/` 後，實際插件 API 記錄 `host_not_allowed`。redirect 私有目標另有單元測試。外部 redirect source 本身未驗證。 |
| `requestHost` 確認、拒絕冷卻、申請速率與撤銷 | Host API 邏輯通過隔離 Electron 驗證；確認框視覺操作未驗證 | 對話框回應以 CDP stub 分別模擬允許與拒絕。拒絕 `example.com` 後再次申請回 `denied`；兩個公開網域成功加入 `grantedHosts`；同一插件第 4 次申請回 `rate_limited`；面板將授權清單設為空後確認已撤銷。 |
| 密鑰加密儲存、不回顯、移除時刪除 | 未驗證 | 使用者要求不得觸碰電腦密碼鑰匙圈，因此沒有再執行任何密鑰讀寫或加密儲存驗收。先前隔離環境回報 `safeStorage.isEncryptionAvailable() === false`，假值寫入回 `secret_unavailable`；這不代表加密成功。單元測試以隔離 fake safeStorage 覆蓋加密、讀取權限及移除行為。 |
| `onStatusChange` 接收 Codex／Claude 狀態變更且只含規定欄位 | 部分隔離 Electron 驗證；真實 Agent adapter 未驗證 | 寵物視窗透過現有 Presentation 投影管線注入 `agentFamily: 'claude-code'` 狀態變更；插件收到事件，欄位為 `agentFamily, at, dnd, name, petId, previousState, visibleState`。這是隔離注入，不是真實 Codex／Claude 程序事件。純模組測試確認 status object 欄位集合。 |
| 開發者模式資料夾載入與自動重載 | 隔離 Electron 通過 | 開啟開發者模式，載入 `hello-feed` 資料夾，寵物 DOM 出現 `Hello Feed` 泡泡；修改來源後 watcher 重新載入插件。 |
| 依入門教學從零建立插件，在隔離 Electron 載入並看到泡泡；打包並安裝 | 隔離 Electron 通過 | 建立 `plugin.json` 與 `dist/main.js`、資料夾載入並看到泡泡、編輯來源觸發自動重載。依修正後命令在來源資料夾內執行 `zip -r ../hello-feed.agentpet-plugin plugin.json dist/`，輸出檔列出三個預期項目；面板 `selectPluginArchive()` 回傳安裝計畫，`installPluginPlan()` 成功安裝。 |
| Storage、settings、schedule Host API | 隔離 Electron 通過（settings change callback 僅有自動測試） | 插件 log 確認 storage 寫入／讀回 `{found:true,value:"roundtrip"}`、settings 預設值 `{"mode":"safe"}`；等待使用者偏好最短 60 秒後觀察到 `schedule-fired`。settings 表單變更通知另由單元測試覆蓋。 |

## Electron 實機驗證

依 §0.4a 使用暫存 `HOME` 與 `user-data-dir` 啟動 Electron，沒有使用已安裝 App 的資料目錄；透過 9348／9349 CDP target 執行面板、寵物與 main 的測試操作，結束時已關閉隔離程序。此環境的 17373–17375 埠已被既有 App 使用，啟動時出現 handoff 註明可接受的 port-in-use 訊息；另看到既有 `project-pets-get-enabled` unauthorized IPC 記錄，未由本 Phase 引入或修改。

| 實測項目 | 步驟與觀察結果 |
|---|---|
| 教學資料夾載入與通知泡泡 | 面板選取 `hello-feed` 開發資料夾並啟用；寵物視窗 `.plugin-feed-toast` 顯示 `Hello Feed`、`P14 Electron smoke` 與通知內文，並觀察到 `onPluginFeedItem`。 |
| 開發者 watcher | 修改暫存插件來源後，診斷記錄顯示重新 activate；面板快照標示 `development: true`。 |
| 教學 archive 安裝 | 從來源目錄依文件命令輸出到上一層；archive chooser 回傳 `kind: reinstall` 安裝計畫，確認後面板回傳安裝成功、`development: false`。 |
| `net.fetch` 攻擊面 | `evil-network` 真實 Worker 的 log 顯示 manifest host 回應 status 404；未宣告 host、HTTP、IP、localhost、私有網段均被拒。遠端 redirect source 無法連線；注入 302 私有目標後，實際 Host API 阻擋 loopback。 |
| `requestHost` | 使用暫存插件逐項呼叫；以 CDP 對話框 stub 回應拒絕／同意。診斷顯示拒絕、24 小時同 host 冷卻、每 10 分鐘三次上限；面板快照先顯示已授權 `api.github.com` 與 `www.iana.org`，撤銷後清單為空。 |
| Storage 與 settings | API smoke log 顯示 storage round-trip 成功及 settings 預設值 `mode: safe`。 |
| 排程 | manifest 最短間隔為 30 秒、使用者偏好為 60 秒；隔離 Electron 等候後診斷 log 出現 `schedule-fired`。 |
| Agent 狀態 | 從隔離寵物視窗發布一筆 `claude-code` Presentation snapshot；插件收到 `onStatusChange`，log 中欄位名稱符合 allowlist。只驗證注入快照，不代表真實 Agent integration。 |
| 密鑰 | 沒有執行加密、回顯或移除測試。隔離環境的 encryption availability 為 false；使用者明確要求不得觸碰電腦密碼鑰匙圈。 |

## 安全檢查

- `pnpm audit --prod --audit-level moderate`：通過，`No known vulnerabilities found`。
- Secret／個資模式掃描：涵蓋 Phase 12 起至本報告草稿的所有追蹤檔案新增內容。私鑰、GitHub／OpenAI／Slack token、AWS key、Google API key 與本機使用者路徑均未命中；Email pattern 命中兩筆測試用 `.example.com` 保留網域佔位值，不含個人郵件；電話 pattern 的 8 筆命中都是網路測試中的 IP 位址形式，沒有電話號碼。commit author email 均使用 GitHub noreply 格式。沒有發現本機使用者路徑、個人聯絡資料或符合憑證模式的值寫入文件／程式碼。
- IPC／最小權限：新 API 透過已驗證插件身分的 Host RPC；面板設定 IPC 綁定可信任面板 sender，並對插件 id、網域、設定 patch 與輸入長度執行執行期驗證。單元測試涵蓋未授權 API、錯誤 payload 與 status 欄位。
- 網路邊界：只允許 HTTPS、無帳密及空／443 port；manifest／使用者授權網域比對後，每一 redirect 重新檢查 URL、host 與 DNS；解析結果含 loopback、私有、link-local、CGNAT、multicast 與 IPv4-mapped IPv6 即拒絕。仍保留 handoff 指定的 DNS 檢查與實際連線之間時間差風險。
- 檔案／密鑰／設定：插件資料檔案拒絕 symlink 與非一般檔；偏好和 settings 測試涵蓋安全路徑、原子寫入、大小界限及 schema 驗證。密鑰實機驗收未執行，詳見上文。
- 通知與 UI：插件文字以純文字呈現，設定與診斷不回傳密鑰原值；回歸測試涵蓋選填 RPC 參數避免 `undefined` 進入 JSON message。
- 版本／依賴：`package.json` 仍是 `1.2.4`；未新增 runtime dependency，未改 `.claude/`，沒有執行 `pnpm build`。

## 手動驗收步驟

以下步驟可在 macOS 專案目錄照做；每一步列出預期結果。使用獨立暫存 HOME 與 user-data，不指向已安裝 App 的資料目錄。

1. 依 §0.4a 建立暫存資料夾，啟動 Electron 並從 9348／9349 連接各 CDP target。預期主程序、面板及寵物 target 可回應，任何既有 App 埠衝突只顯示 handoff 註明的訊息。
2. 開啟插件面板的開發者模式，選取 `docs/plugins/examples/hello-feed`。預期面板顯示「開發中」，寵物顯示 Hello Feed 通知泡泡。修改 `dist/main.js` 的通知文字並儲存，預期 watcher 自動重載並顯示新文字。
3. 在 `hello-feed` 目錄執行 `zip -r ../hello-feed.agentpet-plugin plugin.json dist/`。預期 archive 位於來源資料夾上一層且僅含 `plugin.json` 與 `dist/main.js`；在面板選取並確認，預期安裝成功且 development badge 消失。
4. 以 `node scripts/pack-test-plugin.mjs evil-network /tmp/evil-network.agentpet-plugin` 建立網路 fixture，安裝後檢查插件診斷。預期 manifest host 連線取得 HTTP response；未宣告 host、HTTP、IP、localhost、私有網段與 redirect 私有目標均回 `host_not_allowed`。
5. 使用 manifest 宣告 `network.userGranted: true` 的測試插件呼叫 `net.requestHost`。預期允許後網域出現在面板清單；拒絕後同網域冷卻期內回 `denied`；10 分鐘內第 4 次新網域申請回 `rate_limited`；撤銷後對該網域的 fetch 回 `host_not_allowed`。Native 對話框需在隔離環境以允許／拒絕按鈕操作。
6. 使用非密鑰 settings 欄位變更 repository 值並儲存。預期表單使用 schema 的預設值，Worker 收到 `settings.onChange`；此步不輸入或讀寫任何密鑰，也不操作個人密碼鑰匙圈。
7. 啟用有 `agentStatus` 權限的測試插件，透過真實 Codex／Claude 狀態來源切換 idle／busy。預期 callback 僅含 `petId`、`name`、`agentFamily`、`previousState`、`visibleState`、`dnd`、`at`；狀態變化按 1 秒合併。
8. 設定 `schedule.every(60, ...)`，等待一分鐘。預期診斷出現一次 schedule callback；停用插件後不再有 callback。

## 殘餘風險與待決問題

1. 依使用者要求未觸碰電腦密碼鑰匙圈；密鑰加密持久化、不回顯及移除刪除均未做 Electron 實機驗收。既有隔離環境 encryption availability 為 false，不能據此宣稱成功。
2. 遠端 `httpbin.org` redirect source 在此環境無法連線；私有 redirect 目標已由單元測試及 Electron 內注入的 302 驗證，但未驗證遠端 redirect source 的完整網路往返。
3. Agent 狀態事件以注入的 `claude-code` Presentation snapshot 驗證；真實 Codex／Claude adapter 狀態更新未驗證。`pet.status()` 的 live smoke fixture 只記錄了陣列頂層 key `0`；每筆資料欄位由單元測試覆蓋，未在 Electron log 單獨列出。
4. `requestHost` 的同意與拒絕結果由 CDP stub 驅動，Host API、冷卻、限流、授權存取及撤銷均實測；原生確認框的實際畫面與滑鼠點擊未驗證。
5. `net.fetch` 的 DNS 查詢與實際連線之間仍有 DNS rebinding 時間差，為 handoff 已知限制。
