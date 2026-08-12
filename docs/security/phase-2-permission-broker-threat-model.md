# Phase 2 Permission Broker 威脅模型

> 適用範圍：Phase 2「Permission Broker + Bubble + Scoped Hotkeys」
> 基準版本：`0.6.0`
> 安全原則：預設僅觀察；只有通過偵測、版本與健康檢查，且明確宣告 `permissions: "respond"` 的 Agent Adapter 才能建立可回應請求。

## 1. 安全目標

- 使用者的決策只能送回建立該請求的 Agent Adapter。
- 每個請求只接受一次 `allow_once` 或 `deny`，不提供永久允許。
- Generic `/v1/events`、Renderer 與 Presentation MCP 都不能建立或回覆 Broker 請求。
- event payload 不接受 callback URL、command、port、pipe path、response handle 或 broker nonce。
- 請求逾時、Agent 已回覆、Adapter 中斷、系統鎖定／暫停或應用程式結束時一律失效。
- 稽核紀錄只保存識別資料、狀態與終止原因，不保存 prompt、tool args、token、description 或 response handle。

## 2. 信任邊界

| 元件 | 信任等級 | 允許 | 禁止 |
|---|---|---|---|
| Generic `/v1/events` | 已驗證但不受信任的狀態來源 | lifecycle/status projection | 建立 Broker request、提供 response channel |
| Agent Adapter port | 通過偵測與健康檢查後才受信任 | 建立 request、持有 opaque handle、回報外部解決 | 接受 payload 指定的 URL 或 command |
| Permission Broker（main） | 安全決策中心 | state machine、TTL、CAS、dispatch、audit | 將 handle 暴露給 Renderer |
| Preload IPC | 窄化的使用者意圖橋接 | request ID、`allow_once`／`deny` | callback、handle、adapter command |
| Renderer | 假設可能遭入侵 | 顯示消毒後的 view model、送出使用者意圖 | 建立 request 或決定 dispatch 目的地 |
| Scoped hotkey service | 條件式輸入來源 | 回覆目前最前方且符合條件的 request | 背景常駐或指定任意 request |
| Presentation MCP | 不受信任的展示管道 | status、react、say | permission、command、檔案或成長資料修改 |

## 3. Broker 不變條件

1. respond capability 只能來自 main-owned Adapter registry，不能由事件 payload 宣告。
2. request identity 由 `requestId + adapterId + agentId + sessionId + generation` 綁定。
3. TTL 以 main process 收件時間計算，預設 60 秒，限制在 15–300 秒。
4. 只有 `pending` 能以 compare-and-set 進入 `deciding`；所有 terminal state 都拒絕重播。
5. response handle 是 Adapter-owned opaque value，只存在 main process 記憶體，不持久化、不送往 Renderer。
6. Renderer 只取得 allowlist view model；所有 IPC 參數仍須在 main process 再驗證。
7. 通知點擊只能開啟對應 UI，不等同批准。
8. DND 不隱藏 permission bubble 與 Tray attention，但仍抑制聲音、跳動及普通通知。
9. 高風險或文字遭截斷的請求不得使用快捷鍵 Allow，必須在 bubble 明確操作。
10. Agent 已在終端回覆、Adapter 中斷或生命週期結束時，bubble 必須立即撤除。

## 4. Generic HTTP 的 observe-only 規則

既有 `/v1/events` 必須維持相容，但永遠沒有 respond capability：

- `waiting-permission` 經 allowlist normalizer 轉成 `permissionNotice.responseMode = "external_only"`。
- UI 顯示「Permission needed / Return to the terminal to respond」。
- 即使 DND 開啟也保留提示，但不顯示 Allow／Deny、不註冊快捷鍵、不開 decision IPC。
- `callbackUrl`、`command`、`port`、`pipe`、`responseHandle` 及偽造的 `permissionNotice` 一律丟棄。
- `GENERIC_HTTP_CAPABILITIES.permissions` 固定為 `none`，`permissionModes` 固定為空陣列。

此提示只是展示狀態，不是 Permission Broker request。只有專用 Adapter 的受信任通道能建立真正的 request。

## 5. 狀態機與競態處理

```text
pending --decision CAS--> deciding --adapter delivered--> allowed | denied
   |                         |--already resolved--------> cancelled
   |                         |--failed------------------> delivery_failed
   |--TTL-----------------------------------------------> expired
   |--external resolve/disconnect/lock/suspend---------> cancelled
```

- 同一 request 的第二個 bubble、hotkey 或 Renderer intent 必須回覆 conflict，且不能再次 dispatch。
- 進入 terminal state 時中止尚未完成的 Adapter delivery；Adapter 仍須以 Agent 的 resolution event 做最終對帳。
- request queue 依 main process 收件順序排列；快捷鍵只能作用於最前方、仍為 `pending` 且 `hotkeyEligible` 的請求。
- request record 有明確容量上限；達上限時 fail closed，不得移除舊 record 來繞過 anti-replay。
- app restart 不恢復 pending request 或 response handle；Agent 必須重新送出仍有效的 request。

## 6. 主要攻擊與控制

| 攻擊 | 控制 |
|---|---|
| 偽造 event POST 取得批准 | Generic ingress 無 respond capability；專用 Adapter token；schema allowlist |
| 重播 request／decision | requestId、generation、TTL、terminal CAS、decision ID、nonce |
| callback SSRF 或任意指令 | 事件 payload 禁止 URL／command／port／pipe；只使用 Adapter-owned handle |
| 快捷鍵誤批 | 只在 bubble 可見時註冊；高風險與截斷內容禁用 Allow hotkey |
| 終端已回覆但 bubble 尚在 | Adapter resolution reconciliation；外部解決會取消 request |
| app restart 後誤送舊決策 | 啟動時取消所有 pending；response handle 不持久化 |
| Renderer XSS／compromise | context isolation、typed preload、main-side allowlist 與 sender 驗證 |
| Adapter 中斷 | 取消該 Adapter 全部非 terminal request；停用相關 hotkey |
| 佇列耗盡記憶體 | request／audit 容量上限、payload 長度限制、rate limit |

## 7. Phase 2 Release Gate

完整 Phase 2 不得只交付 observe-only UI。版本確認前必須完成：

- pure state machine 對 spoofing、replay、TTL、容量、並行決策、restart、external resolution 與 abort 的測試；
- preload／IPC sender、main frame 與 runtime payload 驗證；
- scoped hotkey 在 terminal、hidden、lock、suspend 與 Adapter disconnect 時的撤銷測試；
- 至少一個真正 `permissions: "respond"` 的 Adapter，在 Windows packaged Electron 完成一次性 E2E；
- Liquid Glass bubble 的 light/dark、focus、reduced motion、reduced transparency、high contrast 與 DPI 檢驗；
- dependency audit、secret scan、type-check、unit、Vite build、packaging 與 final diff review。

在真正的 Adapter response channel 與 packaged E2E 完成前，本階段只能標示為「observe-only 基礎已完成」，不得宣稱 Permission Control 已可正式使用。
