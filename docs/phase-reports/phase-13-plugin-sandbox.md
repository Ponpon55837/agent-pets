# Phase 13 驗收報告：Sandbox Host + 本機安裝

- 日期：2026-10-23
- 目前版本：1.2.4（未修改）
- 階段狀態：P13.1–P13.6 實作完成；六個 checkpoint 的 §0.4 四項檢查通過並已推送。Electron 實際操作未驗證，見手動驗收步驟。
- 建議版本：1.3.0（Phase 12–16 整體 minor 建議；本階段不改版）
- 分支：feat/plugin-host
- origin/main：已於 P13.1 前以 merge 合併；merge commit a0c571a908d95f05173ab29d8c9b8bda0a4dc1a5。合併前 origin/main 的 package.json Vue 為 ^3.5.44（PR #13 已合併）。沒有 rebase 或合併到 main。

## 範圍摘要

完成本機插件套件安裝與 registry、隔離 Plugin Host Worker、受限 protocol 與 RPC、feed／reaction／storage／log API、寵物通知 UI 與未讀數、雙語插件管理面板，以及 Phase 13 安全測試 fixtures。Plugin Host preload 只提供 MessagePort；安裝和檔案操作採邊界驗證、暫存後原子替換與 symlink 拒絕。插件偏好檔若是 symlink 或非一般檔案，面板保留可用並顯示繁中／英文錯誤。

P13.6 增加七個原始 fixture 和測試打包器。三次連續崩潰停用插件時，宿主現在會在通知中心加入系統通知。Fixture 的 JavaScript 僅供測試；本階段沒有在 Electron 中執行它們。

## Checkpoint

| Checkpoint | 內容 | Commit SHA | 結果 |
|---|---|---|---|
| P13.1 | PluginRegistry 安裝計畫、安裝／更新／降版／移除與偏好保護 | 05011b28d19cffdb1b8e4f425061aa1b7c248784 | §0.4 通過；已推送 |
| P13.2 | Secure plugin protocol、隔離 Host 視窗、Worker bootstrap／生命週期 | e9be74de1bc1600b15ece138728f510f98f0439f | §0.4 通過；已推送。因 simple plugin 的多 preload 輸入在 codeSplitting=false 下無法建置，改成分開建置第二個 preload，並由既有 preload 啟動 Electron。 |
| P13.3 | Host RPC Broker 與 feed、reaction、storage、log API | b5bd18ba85aa5b60ee2fcbbe7179dc9f6f3a0828 | §0.4 通過；已推送 |
| P13.4 | 寵物端通知泡泡、通知中心與未讀 badge 接線 | af885f93ac0fd2fe2db7f65792877e7e8cc329fb | §0.4 通過；已推送 |
| P13.5 | 雙語插件管理面板、安裝確認、控制、診斷與通知中心 | 5c85968ddf0064be3367951b002a196a7a3f24f8 | §0.4 通過；已推送 |
| P13.6 | 惡意／正常 fixture、fixture 打包器與 Phase 13 收尾 | 本報告所在的最終 checkpoint commit（完整 SHA 見最終回報） | §0.4 通過；隨本報告所在最終 checkpoint commit 提交並推送 |

## §0.4 檢查結果

每個 checkpoint 均依序執行下列四項實際指令；每項均通過。

| Checkpoint | pnpm exec vue-tsc --noEmit | pnpm test:unit | pnpm exec vite build | git diff --check |
|---|---|---:|---|---|
| P13.1 | 通過 | 198/198 | 通過 | 通過 |
| P13.2 | 通過 | 201/201 | 通過，含 dist-electron/plugin-host-preload.js | 通過 |
| P13.3 | 通過 | 208/208 | 通過，含 renderer、main、preload 與 plugin-host-preload | 通過 |
| P13.4 | 通過 | 210/210 | 通過 | 通過 |
| P13.5 | 通過 | 214/214 | 通過 | 通過 |
| P13.6 | 通過 | 223/223 | 通過，含 renderer、main、preload 與 plugin-host-preload | 通過 |

未執行 pnpm build。本次手動 Electron 驗收未執行；Vite build 和純模組測試不代表 Electron 執行期驗收。

測試 fixture 打包指令（測試／複檢用途，不會被產品流程呼叫）：
    node scripts/pack-test-plugin.mjs ok-notify /tmp/ok-notify.agentpet-plugin

其餘 fixture 可將 ok-notify 換成 evil-fetch、evil-loop、evil-spam、evil-xss、evil-spoof 或 evil-zip。測試本身使用 fflate 的 zipSync 動態打包，沒有提交二進位套件。

## Phase 13 驗收條件

| 驗收條件 | 結果 | 證據與限制 |
|---|---|---|
| 本機安裝、更新、降版確認、權限重新同意、移除（保留／不保留資料） | 單元測試通過；Electron 未驗證 | PluginRegistry 測試涵蓋安裝計畫、更新／降版、重新同意、原子安裝與移除。未在設定面板實際操作。 |
| ok-notify 通知泡泡、來源標籤、寵物縮小後通知中心與 Edge 未讀數、恢復後只補最新一則 | 純模組測試通過；Electron UI 未驗證 | Feed 測試涵蓋 TTL、佇列、隱藏後恢復及未讀。未在實際寵物視窗觀察動畫或 badge。 |
| 每個 evil fixture 都被擋下或終止，且 App 其他功能正常 | 部分純模組／靜態測試通過；Worker 實際行為未驗證 | 見下方逐項結果；沒有將 fixture 放進 Electron Worker 執行。 |
| 插件總開關關閉後沒有插件執行、Host 視窗關閉 | 程式與生命週期接線已完成；Electron 未驗證 | 未手動檢查實際 Host 視窗及 Worker 數量。 |
| 新 IPC 驗證寄件者與 payload | source review 與自動測試通過 | 面板 IPC 嚴格綁定面板 sender；輸入驗證測試覆蓋插件 id、通知 id、安裝 token、patch 與 unsafe preference 錯誤。Host RPC 由 Main 指派插件身分並拒絕自稱身分或未授權 method。 |

### Fixture 自動測試及實際執行狀態

| Fixture | 自動測試結果 | Electron Worker 實際結果 |
|---|---|---|
| ok-notify | manifest／entry／PNG icon 有效；可用 ZIP 安裝；原始碼提供通知及 storage 寫入／讀回路徑。 | 未驗證；沒有在 Worker 執行通知或 storage 往返。 |
| evil-fetch | 原始碼涵蓋 fetch、WebSocket、importScripts 與外部 dynamic import；Host CSP 的 connect-src 'none' 靜態條件通過。 | 未驗證；沒有實際嘗試網路或觀察拒絕結果。 |
| evil-loop | 原始碼含無限迴圈；bootstrap heartbeat source assertion 通過。 | 未驗證；沒有觀察 watchdog 終止 Worker、重啟或累計崩潰。 |
| evil-spam | feed/controller 模擬 100 則：5 則可送泡泡，另外 95 則保留在通知中心、不送泡泡。 | 未驗證；沒有在實際 Worker 執行 100 次呼叫。 |
| evil-xss | feed 將 HTML payload 淨化為不含標籤的純文字。 | 未驗證；沒有在 Electron 視窗確認文字呈現且無 script 執行。 |
| evil-spoof | Broker 拒絕冒稱另一插件身分及未宣告的 pet.react 權限。 | 未驗證；沒有在實際 Worker／MessagePort 執行攻擊。 |
| evil-zip | Registry 拒絕 ../ traversal 與超過檔案數限制的安裝計畫。 | 未驗證；未在安裝面板實際選取惡意 ZIP。 |

## 安全檢查

- **依賴稽核：未執行。** 使用者指定僅執行 §0.4 四項命令，因此本階段沒有執行 audit；不據此宣稱依賴無弱點。
- **Repository secret scan：未執行。** 同樣受命令限制；新增 fixture 使用合成測試字串與圖示，沒有刻意放入憑證。
- **IPC／最小權限：source review 與測試通過。** 面板 IPC 驗證 sender 並限制 payload；Host preload 僅提供 MessagePort，插件身分由宿主端指派。Broker 對未知 method、過大 payload、錯誤身分、未宣告權限及 storage 邊界採拒絕策略。
- **路徑與檔案系統：source review 與測試通過。** 插件安裝經 archive guard、manifest 與套件檔案檢查，再暫存後原子替換；protocol/storage/preferences 對檔案類型與 symlink 做 fail closed 驗證。測試涵蓋 traversal、檔案數／大小限制及 symlink。
- **通知與面板文字：自動測試通過。** Feed 對文字作純文字淨化；面板使用 Vue interpolation，沒有以 v-html 顯示插件資料。三次崩潰停用的宿主通知進通知中心，不走插件 feed 泡泡和速率額度。
- **通知路徑同步 I/O：source review。** 通知狀態以記憶體中的 controller 更新，未新增同步檔案寫入。
- **本機伺服器、Permission Broker、MCP 安全 gate：不適用。** 本 Phase 沒有新增本機 server 或 Permission 回應能力；reaction 使用既有受限 Presentation queue。
- **版本／相依：通過。** 未改版本號、未新增 runtime dependency，未改 .claude/。Vue 3.5.44 是使用者要求的 origin/main merge 內容。

## Electron 手動驗收

以下操作均為**未驗證**。為符合本次僅執行 §0.4 命令的限制，沒有執行 pnpm dev。複檢者可在專案目錄依序照做：

1. 用 pnpm dev 啟動 App，等待主寵物出現；開啟設定面板的「插件」分頁。預期面板可正常操作，插件總開關預設關閉，沒有啟用中的 Worker。
2. 打包並在面板安裝 ok-notify：node scripts/pack-test-plugin.mjs ok-notify /tmp/ok-notify.agentpet-plugin。確認安裝計畫顯示第三方警告與權限；確認後啟用插件及總開關。預期通知泡泡有插件來源標籤，且插件能寫入再讀回自己的 storage。
3. 在泡泡顯示時讓寵物切到 Mini／Edge 或隱藏。預期通知轉入通知中心並增加未讀；Edge 把手顯示未讀數。連續觸發多則通知後恢復可見，預期只補顯示最新一則且使用新的 TTL。
4. 建立同一插件 id 的新版本套件（提高 version 並加入一項新 permission）與舊版本套件，分別安裝。預期計畫分別標示更新、權限重新同意和降版；拒絕新增權限時保留舊版。移除時分別測試保留與刪除資料，預期行為符合選項。
5. 依序打包並安裝 evil-fetch、evil-loop、evil-spam、evil-xss、evil-spoof。預期：外連與 API 呼叫遭拒；無限迴圈 Worker 被 heartbeat watchdog 終止，三次崩潰後停用並在通知中心出現宿主訊息；spam 受限流且超額項目不進泡泡；XSS 只顯示純文字；偽造身分與未授權 method 被拒絕。每項操作後確認 App 其他功能仍可用。
6. 建立一個 ZIP，包含 ../escape.txt，另建立一個超過 plugin archive 檔案數上限的 ZIP，改名為 .agentpet-plugin 後在安裝面板選取。預期兩者均在建立安裝計畫前以無效 archive 拒絕，且安裝目錄外沒有新增檔案。
7. 啟用插件後關閉插件總開關，再檢查 Host 視窗與通知。預期所有插件 Worker 停止、Host 關閉；重新啟用時才重新建立 Host。
8. 在測試環境建立指向 symlink 或非一般檔案的 plugin preferences 路徑，重新開啟插件分頁。預期面板仍可操作，繁中／英文分別顯示對應的偏好檔安全錯誤，沒有覆寫該路徑。

## 殘餘風險與待決問題

1. 本機 Electron UI 與真實 Worker 的安裝、更新／降版／權限重新同意、通知、Host 關閉、DND／可見性變化，以及全部 evil fixture 執行結果仍待複檢者手動驗收。
2. 依本次命令限制，依賴稽核與 repository secret scan 未執行；不能從四項 build/test gate 推論這兩項檢查通過。
3. 本階段只執行指定的 pnpm exec vite build，沒有執行完整 packaging；平台封裝後的 sandbox／資源路徑行為未驗證。
4. 更新／降版手動驗收需複檢者準備同 id、不同版本及權限集合的套件；現有打包器直接封裝來源 fixture，不提供 manifest 變體參數。
