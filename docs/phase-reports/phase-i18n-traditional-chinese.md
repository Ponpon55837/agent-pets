# i18n／繁體中文與語系選擇階段報告

日期：2026-08-13
版本：0.8.1

## 範圍

- 建立共用 `src/i18n.ts`，集中管理繁體中文 UI、Tray、通知、Setup Wizard、權限提示與錯誤訊息。
- 設定面板五個分頁、Dashboard、Quota、XP／Mood、寵物管理與 Presentation MCP 專案管理改用翻譯 key。
- Desktop Pet 的 Quota、權限風險、Edge handle、倒數提示與剩餘用量文字改用繁體中文。
- Electron Tray、原生通知、原生資料夾／素材選擇器，以及 Adapter／MCP 診斷訊息完成繁體中文化。
- Quota provider 的登入、逾時、速率限制、API 回應與憑證錯誤透過同一翻譯層顯示中文；保留 Codex／Claude／Quota／token 等 canonical terms。
- README 中補充語言規則：`Running`、`Thinking`、`Permission`、`Idle`、`Allow once`、`Deny`、Agent／MCP／token 等 canonical technical terms 保留原文。
- 新增 `zh-TW`／`en-US` 語系選擇，設定保存於 main-owned desktop preferences，並同步 renderer、Tray 與原生通知。
- Locale IPC 只接受白名單值；設定頁新增獨立的 Language 分區，切換後立即更新文字與時間格式。

## 驗證證據

- `node node_modules\\vue-tsc\\bin\\vue-tsc.js --noEmit`：通過。
- `pnpm.cmd exec vite build`：通過，renderer 49 modules、Electron main 28 modules、preload 2 modules。
- `pnpm.cmd test:unit`：72/72 通過。
- `pnpm.cmd build`：通過；建置前檢查確認沒有本專案執行中的 Agent Pets，產生 `release\\AgentPets-0.8.1.exe`（約 102.0 MB）與 `release\\win-unpacked`。
- `pnpm.cmd audit --prod --audit-level moderate`：無已知漏洞。
- 高風險 secret pattern scan：未發現結果。
- `git diff --check`：通過。

## 安全檢查

- i18n 僅是純字串與 interpolation，不接收任意 HTML；Presentation MCP 的純文字限制與既有 main-process validation 維持不變。
- 翻譯不會把外部事件的 action／description／project path 當成 HTML；外部內容仍由既有 renderer escaping 與長度限制處理。
- 原生通知只加入本地化標題，仍不顯示 tool argument、token、prompt 或 permission description。
- Electron native dialog、Tray 與 Adapter 診斷未新增 IPC channel 或權限邊界。
- Locale patch 只允許 `zh-TW` 與 `en-US`，無法透過 IPC 寫入任意字串；偏好檔仍使用 bounded read 與 atomic replacement。

## 殘餘風險

- 尚未逐一在不同 Windows display scaling、亮／暗桌布與 packaged Electron 實機截圖驗證中英文長文案的換行；建議下一步以 `release\\win-unpacked\\Agent Pets.exe` 做視覺 smoke test。
- Adapter 由外部 runtime 產生的未知錯誤訊息會保留原文；已知 setup／MCP 錯誤會透過 `translateBackendError` 轉換。
- macOS／Linux 原生 Tray 與通知行為仍未在本環境驗證。

## 版本建議

本階段新增受白名單保護的既有 desktop preferences 欄位，但未改變 event、MCP 或 Agent adapter public contract；已依確認升 patch 至 0.8.1，待提交。
