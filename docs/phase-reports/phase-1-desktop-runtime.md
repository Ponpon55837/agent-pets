# Phase 1 — Desktop Runtime：Tray、Notification、DND

日期：2026-08-11
原始基線版本：`0.5.6`
確認版本：`0.5.7`
狀態：功能、安全、視覺與 Windows 實機驗收完成；使用者已確認並升版

## 範圍

本階段把 Agent Pets 從「視窗型狀態顯示器」補齊為可長時間常駐的桌面應用程式。範圍包含 Tray、原生通知、勿擾模式、音效與通知偏好、登入時啟動、主視窗隱藏／恢復、Liquid Glass 設定介面，以及對應的持久化與 IPC 邊界。

本階段不包含 Permission Broker、全域核准快捷鍵、自動更新、Mini/Edge mode、XP、MCP 或雲端功能。

## 已交付

- 新增 main process 擁有的 `DesktopPreferencesStore`，使用 64 KB 上限、拒絕 symlink、原子替換寫入與 boolean 欄位白名單。
- 新增單例 `DesktopTrayController`：顯示／隱藏寵物、開啟控制面板／Settings、DND、音效、通知、登入啟動、待處理數量、可見 attention badge、Quit；自動更新項目明確標為尚未提供。
- 關閉寵物視窗時改為隱藏並保持 hooks、事件伺服器與 Tray 運作；意外銷毀 renderer 後可由第二實例或 Tray 路徑重建兩個視窗。
- 新增通知分類與投遞模組：waiting-permission、waiting-input、success、error；同 session／事件類別 60 秒冷卻，完成類事件 10 秒批次合併。
- 通知只含正規化 Agent 名稱與專案 basename；不顯示或記錄 prompt、tool arguments、session ID、token 或 credentials。
- 通知診斷紀錄最多 200 筆，只保存時間、類別、結果與合併數量。
- DND 會抑制原生通知、音效、額外動態與非必要 bubble，但不停止 `/v1/events`、狀態更新或 Tray attention。
- 新增窄化 preload API 與 IPC：初始化偏好、更新白名單偏好、接收 main process projection、由 Tray 直接開啟 Settings。
- Windows portable 登入啟動使用 electron-builder 提供的原始 launcher 路徑，拒絕不存在、非絕對、非 `.exe` 或 symlink 的路徑，避免註冊暫存解壓目錄。
- 設定介面採 Liquid Glass 分層：外層功能／導航層保留 glass，內容群組不再疊加 backdrop blur，並加入 reduced-motion、reduced-transparency、high-contrast 與鍵盤 focus fallback。
- 新增 Node 內建單元測試與 `pnpm test:unit`，同步更新中英文 README。

## 模組與邊界

| 模組 | 擁有者 | 邊界 |
|---|---|---|
| `electron/desktop-preferences.ts` | Main | 偏好讀寫、runtime validation、Windows 登入啟動 adapter |
| `electron/notification-policy.ts` | Pure domain | 事件分類、文字縮減、cooldown、terminal aggregation |
| `electron/desktop-notifications.ts` | Main | Electron Notification、DND/foreground policy、attention、bounded log |
| `electron/desktop-tray.ts` | Main | Tray 單例、menu projection、native resource lifecycle |
| `electron/preload.ts` | Preload | 只暴露必要 boolean command 與 typed projection |
| `src/stores/agentStore.ts` | Renderer | 顯示 main projection；不自行決定 Tray/notification/startup truth |

Renderer 不能傳 callback URL、命令、檔案路徑或 notification 內容。所有新 IPC 仍經過既有 main-frame、第一方 URL 與 BrowserWindow sender 驗證。

## 功能驗收

| 驗收項目 | 結果與證據 |
|---|---|
| 單元測試 | `pnpm test:unit`：11/11 通過；涵蓋 legacy sound migration、持久化、未知／非 boolean 欄位拒絕、unsupported startup、portable 原始 EXE、DND 啟動 fail-closed、通知隱私、integration event 抑制、cooldown、aggregation、Tray attention bitmap 與邊界拒絕 |
| 型別檢查 | `vue-tsc --noEmit` 通過 |
| 生產建置 | Vite renderer/main/preload：44／10／2 modules，全部通過 |
| 完整 portable | 升版後 `pnpm build` 通過；`release/AgentPets-0.5.7.exe`，101,847,741 bytes，SHA-256 `71B67FA7DA2910F4CA5768B21D6F6EAB69ADD6E797913B59E8C55174C50036CA` |
| Tray 資源 | `build/icon.png` 已包含於 ASAR；真實 packaged main process 啟動且保持 responding |
| 關閉後常駐 | 真實 Windows Electron 將兩個 renderer 關閉後，原始 main process 仍存活，事件伺服器仍可接收事件 |
| 視窗恢復 | renderer 真正銷毀後啟動第二實例：原始 main process 保留、第二實例退出、兩個 `agent-pets://` page target 成功重建 |
| 一般通知 | 背景狀態送入 waiting-input event，HTTP 204；診斷結果為 `shown` |
| DND | DND 開啟後送入 waiting-permission event，HTTP 204；結果為 `suppressed-dnd`，main process 保持運作 |
| DND 啟動競態 | 偏好 projection 尚未載入時，音效、額外 reactions 與 bubble 採 fail-closed；純規則測試通過 |
| Attention badge smoke | `0.5.7` packaged runtime 在 DND 下接收 permission event、更新 Tray attention bitmap 後 main process 持續 responding，最後正常 Quit |
| 通知隱私 | 實機事件包含測試 tool name，bounded notification log 不含該字串 |
| 登入時啟動 | 真實 Windows packaged runtime 回報 supported；實測 `false → true → false` 成功，最後狀態為停用 |
| Quit | 透過與 Tray Quit 共用的 `app.quit()` 路徑結束後，main process、debug port 與 `17373` event port 全部關閉 |

第一次完整封裝曾因先前失敗命令留下的背景 builder 與第二個 builder 同時寫入 `release/win-unpacked` 而發生 rename 競爭。確認並等待單一背景 builder 結束後，後續封裝均採單一程序；最終完整 `pnpm build` 已成功，問題未再出現，且不屬於應用程式碼缺陷。

## Liquid Glass 與可及性驗收

- 使用 320×420（實際 panel 尺寸）進行渲染檢查；`settings-content` 正常捲動，設定項未裁切。
- 外層 panel 使用 regular、偏深色的玻璃層；Desktop content group 的 computed `backdrop-filter` 為 `none`，避免 glass-on-glass。
- 輔助文字提升為 10px、`rgb(157, 163, 180)`、13px line-height；320px 寬仍可閱讀。
- DND checkbox 的鍵盤焦點可見，實際 focus 落在有完整 accessible name 的原生 input。
- `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast: more` 都有 CSS fallback。
- 本階段未更動 click-through 命中演算法、視窗座標或多螢幕 placement；既有行為未被擴張。

## 安全驗收

| 檢查 | 結果 |
|---|---|
| `pnpm audit --audit-level high` | 通過；No known vulnerabilities found |
| Credential pattern scan | 未發現新增 credential；命中僅為既有 quota token 欄位名稱與測試中的惡意 `callbackUrl` fixture |
| IPC sender validation | 新 channel 均呼叫既有 `assertTrustedIpcSender`；偏好寫入限定 panel renderer，初始化 projection 才允許兩個第一方 renderer |
| IPC payload validation | 只接受四個已知 boolean 欄位；未知、非 boolean、callback URL 皆拒絕 |
| IPC least privilege | Windows packaged smoke 確認 panel 可更新偏好、pet renderer 的偏好寫入遭拒絕 |
| Filesystem | bounded regular-file read、symlink reject、atomic temporary write/rename、非 Windows 0600 |
| Notification privacy | 實機與單元測試確認 tool data 未出現在通知或 diagnostic log |
| Native resource lifecycle | Tray `create()` 為單例；attention 時切換帶 badge 的 bitmap；Tray 設定寫入有錯誤邊界；第二實例不建立新 main process；`will-quit` 明確 destroy Tray、notification timer、event server |
| Permission authority | 通知 click 只開啟 sessions panel 並清除 attention；沒有 allow/deny、callback 或命令執行能力 |
| Packaged security | Electron fuses、ASAR integrity、sandbox、context isolation、navigation/permission denial 維持不變 |

## 殘餘風險

- 目前只在 Windows 進行原生 Tray、Notification、portable startup 與 packaged runtime 實測；macOS DMG 的 Tray/Notification/login item 尚未實機驗證。
- Windows Tray icon/menu 是 native OS surface，本輪以 packaged process、單例／重建流程、資源存在與共用 action 路徑驗證；未自動化像素辨識每一個 OS menu item。
- 高對比、降低透明度與降低動態使用 CSS media query 驗證與靜態審查；本輪未切換 Windows 系統設定逐項擷取畫面。
- 通知 click 的安全性以程式碼邊界審查確認；未自動點擊 Windows Action Center 通知。
- `notification-log.json` 是本機診斷資料，雖無 prompt/session/path/token 且最多 200 筆，後續 Settings 可考慮加入清除入口。
- 自動更新仍明確不可用；Tray 僅顯示 disabled 項目，避免誤導。

## 版本決定

使用者於 2026-08-12 確認 Phase 1，並指定採小版本：`0.5.6 → 0.5.7`。

理由：功能全部向後相容，既有 hook event contract 與使用者資料不需破壞性 migration；新增的 desktop preferences 有 legacy sound migration 與安全預設。依使用者的產品版本策略，本階段以 patch 發布。

已更新 package version；未建立 tag、未發布 release。
