# Phase 2 — Permission Broker + Bubble + Scoped Hotkeys 驗收報告

日期：2026-08-12
基準 commit：`3f74996 feat: add desktop tray notifications and dnd`
基準版本：`0.5.7`
確認版本：`0.6.0`
狀態：功能、安全、視覺與 Windows packaged gate 完成；Phase 2 已確認

## 範圍與成果

本階段新增 main-owned Permission Control Plane。OpenCode CLI／Desktop 可透過獨立、已驗證的 Adapter channel 建立 request，使用者可在寵物上選擇 `Allow once` 或 `Deny`。Generic `/v1/events`、Codex、Claude 與 Presentation MCP 都沒有 respond capability；它們只能顯示「回終端處理」的 observe-only 提示。

同一批 UX 亦完成一般 success／error toast 約 3 秒自動關閉與剩餘時間進度條；permission request 與 activity bubble 不會自動關閉。

不包含永久允許、自動批准、任意 callback、遠端控制、帳號／雲端、MCP permission tool 或其他 Agent 的未驗證回覆通道。

## 架構與邊界

| 模組 | 邊界與職責 |
|---|---|
| `electron/event-normalizer.ts` | Generic event allowlist；重建 projection 並丟棄 callback、command、port、pipe、handle 與偽造 capability |
| `electron/permission-broker.ts` | request state machine、TTL、CAS、anti-replay、容量、queue、dispatch、external resolution、audit event |
| `electron/permission-adapter-server.ts` | 獨立 `127.0.0.1:17374` Adapter relay；專用 token、method/path allowlist、Origin／JSON／大小／速率驗證 |
| `electron/permission-audit.ts` | 最多 500 筆、原子寫入、只含狀態／識別／終止原因的本機 audit |
| `electron/setup.ts` | 產生 OpenCode plugin、獨立 permission token；`allow_once → once`、`deny → reject`，不產生 `always` |
| `electron/main.ts` | 組裝 Broker／relay、驗證 IPC sender、同步 queue／Tray attention、註冊與解除 scoped hotkeys、處理 lock／suspend／quit |
| `electron/preload.ts` | 只暴露 sanitized request list 與 `{requestId, decision}` intent |
| `src/components/DesktopPet.vue` | Liquid Glass request card、queue/risk、明確操作與 accessibility；不持有 response handle |

## 功能驗收

| Gate | 結果 |
|---|---|
| Unit | `pnpm test:unit`：35/35 通過 |
| Type | `vue-tsc --noEmit` 通過 |
| Vite | renderer 46 modules、main 15 modules、preload 2 modules，全部通過 |
| Portable build | `pnpm build` 通過；Electron 43.3.0、ASAR integrity 與既有 fuses 保持啟用 |
| Confirmed artifact | `release/AgentPets-0.6.0.exe`，101,855,465 bytes，SHA-256 `11B757AF333B3AD2621F3A9D2A0E53F8EAF52C76C56A7258C17F833736EBE398`；僅供本機驗證，未發布 |
| Installed plugin syntax | 產生的 OpenCode CLI／Desktop plugin 均可作為 ESM 載入，具 event、permission.ask、dispose hooks |
| Packaged adapter round trip | win-unpacked + 已安裝 plugin：bubble Allow → 同一 session／permission ID → OpenCode SDK contract → `response: once` → 204 acknowledgement → bubble 撤除 |
| Explicit deny | 高風險 request 點擊 Deny → relay 回傳 `deny`，沒有永久允許 |
| DND | DND 開啟後 high-risk permission card 超過 4 秒仍保持可見且可操作，不受一般 toast 自動關閉影響 |
| Toast countdown | 實際 Electron renderer：3 秒內 progress transform 下降、逾時後 toast 消失；permission notice 超過 3 秒仍保留且沒有 countdown |
| Visual | Windows 125% DPI、248×107 px regular Liquid Glass card；高風險紅色邊界、queue、Deny／Allow once 清楚；實際透明桌面背景檢視通過 |

## 安全檢驗

| 威脅／邊界 | 結果 |
|---|---|
| Spoofing | Generic event token 不能用於 permission channel；permission channel 使用獨立 256-bit token並拒絕 browser Origin |
| Callback／command injection | Generic normalizer 重建物件；測試確認 callback URL、command、pipe、port、forged handle/capability 不會進入 Broker |
| Replay／race | 第二次決策回 conflict；同一 external create idempotent；錯誤 decision ID 與重複 result 回 409 |
| TTL／restart | 逾時 fail closed；restart 不恢復 pending request 或 response handle |
| External resolution | Agent `permission.replied`、Adapter disconnect、lock、suspend、shutdown 取消 request；in-flight delivery 使用 AbortSignal |
| Renderer compromise | main frame／first-party URL／pet BrowserWindow sender 驗證；payload 只允許 request ID 與兩個 decision enum |
| Hotkeys | bubble 隱藏時解除；只作用於 queue 首項；high-risk 或 truncated request 沒有快捷鍵；terminal／hide／lock／suspend／disconnect 後撤銷 |
| Memory／disk bounds | Broker request 5,000 筆後 fail closed，不刪舊紀錄繞過 replay；memory audit 與 disk audit 各最多 500 筆 |
| Audit privacy | packaged audit 實測只保存 `allowed / allow_once / delivered` 等狀態，不含 title、description、patterns 或 relay handle |
| Dependency audit | `pnpm audit --prod --audit-level moderate`：沒有已知弱點 |
| Secret scan | 排除 dependency／build／release／user-owned `.claude` 後無符合 private key、OpenAI key、AWS key 或 Slack token 的結果 |
| Diff | `git diff --check` 通過；只有既有 Windows LF→CRLF 提示；`.claude/` 未修改、未 stage |

詳細威脅模型：`docs/security/phase-2-permission-broker-threat-model.md`。

## Liquid Glass 與可及性

- 單一 regular glass 操作層，不在卡片內疊加第二層 backdrop blur。
- 以 gradient、edge highlight、shadow 與 risk tint 建立層級；透明桌布上仍有不透明深色基底。
- `role="alertdialog"`、label/description 關聯、原生 button、鍵盤 focus ring。
- `prefers-reduced-motion` 停用按鈕 transition；`prefers-reduced-transparency` 使用不透明背景；`prefers-contrast: more` 使用 2px 高對比邊界。
- permission card 本身是 solid hit target，不會被 click-through 穿透；卡片操作阻止寵物拖曳／開面板事件。

## 殘餘風險與限制

- Packaged E2E 使用實際安裝後的 plugin 與精確 OpenCode 1.18.15 SDK method shape，但以受控 client double 代替會呼叫模型的 live OpenCode session；未消耗使用者模型額度。下一次手動遇到真實 OpenCode permission 時仍應完成一次 smoke。
- Windows 全域快捷鍵的實際註冊／解除路徑已由程式邊界與 UI eligibility 驗證；沒有用 OS 鍵盤自動化觸發，避免影響使用者目前焦點。若 OS／其他應用占用組合鍵，button 仍可用且 Broker 不會降級為自動批准。
- macOS 的 globalShortcut、lock/suspend 與 packaged plugin 尚未在實體 Mac 驗證；不能由 Windows 結果推論。
- `release/AgentPets-0.6.0.exe` 是確認後重建的 Windows portable 產物；未簽署本機建置仍只供本機驗證，不代表已發布。

## 版本建議

版本決定：由 `0.5.7` 升為 `0.6.0`。

理由：本階段新增獨立 localhost protocol、Adapter response contract、typed IPC、全域快捷鍵、持久化 audit 與獨立權限泡泡偏好，屬新的 Control Plane／安全邊界，符合 pet-skill 的 minor 分類。`package.json` 已升版；`pnpm-lock.yaml` 不含 package version metadata，因此保持內容不變。
