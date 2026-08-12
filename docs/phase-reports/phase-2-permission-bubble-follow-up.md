# Phase 2 Follow-up：獨立權限泡泡顯示開關

## 範圍

本次只調整 Permission Bubble 的呈現偏好，不改變 Permission Broker 的安全決策模型：

- 新增 main-owned `permissionBubbleEnabled`，預設為 `true`。
- Settings 與 Tray 都可切換此偏好，且與一般 `Bubble` 分開。
- 關閉時只隱藏 Allow once／Deny 卡片與其快捷鍵；不會自動允許、拒絕或取消請求。
- Broker、Adapter 回覆通道、終端機處理、原生通知與 Tray 待處理徽章維持運作。
- 重新開啟「權限泡泡」開關或 renderer 後，透過 Broker 快照恢復有效請求；逾時請求在 Broker 與 renderer 兩端都會被過濾。完整關閉 App 仍依既有安全規則取消 pending request，不跨程序恢復舊 response handle。

## 驗收條件

| 項目 | 結果 |
|---|---|
| 偏好預設開啟並可持久化 | 通過：desktop preference unit test |
| 偏好只接受 boolean，未知欄位拒絕 | 通過：`parseDesktopPreferencesPatch` |
| Bubble 關閉不改變 Broker／Tray attention | 通過：main gating 與資料流檢查 |
| 到期 request 不進入 UI snapshot | 通過：`listRequests()` expiry test 與 renderer expiry guard |
| TTL 到期主動清理並通知 UI | 通過：Broker unref expiry timer implementation |
| Liquid Glass permission card 保持既有 focus／透明度 fallback | 通過：只加設定 gate，未改 card material |

## 檢驗證據

- `npm.cmd run test:unit`：36/36 通過。
- `npx.cmd vue-tsc --noEmit`：通過。
- `npx.cmd vite build`：renderer 46、main 15、preload 2 modules 通過。
- `pnpm.cmd build`：Windows portable 建置通過。
- `pnpm.cmd audit --prod --audit-level moderate`：No known vulnerabilities found。
- Repository secret scan（排除 node_modules、dist、release、`.claude`）：未發現私鑰或常見 API token pattern。
- `git diff --check`：預計僅有既有 CRLF 轉換提示，無 whitespace error。

## 版本與剩餘風險

- Phase 2 確認後版本為 `0.6.0`，並與主 Phase 2 一起提交。
- Confirmed portable：`release/AgentPets-0.6.0.exe`，SHA-256 `11B757AF333B3AD2621F3A9D2A0E53F8EAF52C76C56A7258C17F833736EBE398`。
- 本輪環境未完成 macOS／Linux 原生 Tray 與 global shortcut 驗證；Windows packaged build 已完成建置，原生畫面自動化受目前 Electron debug session 限制，保留為 residual risk。
