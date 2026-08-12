# Phase 5 驗證報告：Agent Adapter SDK

日期：2026-08-12
目前版本：`0.8.0`
階段狀態：已完成，使用者已確認；版本已升級至 `0.8.0`，本報告與 Phase 5 變更一併提交
版本／提交：依 Phase 5 的 substantial new subsystem／public adapter contract 規則由 `0.7.1` 升為 `0.8.0`

## 本階段結果

Phase 5 將既有 OpenCode、Codex、Claude Code 與 Generic HTTP 接入統一成 main-process Agent Adapter registry。Adapter 只負責偵測、安裝／解除安裝橋接、診斷、capability 宣告與 raw event normalization；Event Core、Progression、Tray、HUD、Pet 元件只接收 canonical `AgentStatusEvent`，不需要知道新 Adapter 的實作細節。

## 已交付

- `src/types/agent-adapter.ts`：`AgentAdapter`、`AdapterDetection`、`AdapterRuntimeStatus`、`DiagnosticReport` 與 capability/status contract。
- `electron/agent-adapter.ts`：OpenCode／Codex／Claude Code／Generic HTTP registry、runtime capability matrix、source selection、adapter claim 防偽與 canonical mapping。
- `electron/agent-adapter-operations.ts`：把既有 setup path、偵測、idempotent installer 與 Windows hook repair 包成 Adapter operations；沒有重寫既有設定合併邏輯。
- `electron/event-server.ts`／`electron/main.ts`：`/v1/events` 先經 Adapter registry，再進 Event Core normalizer；canonical event 帶 sanitized `adapterId`。
- `electron/preload.ts`／`src/env.d.ts`：typed `adapter-diagnose`、`adapter-install`、`adapter-uninstall` IPC。
- `src/components/SetupWizard.vue`：改以 runtime adapter status 顯示 sources、capabilities、health、Diagnose、Test 與 Install；不再硬編碼工具清單。使用 regular Liquid Glass treatment、focus/contrast/transparency fallback。
- `tests/fixtures/agent-adapter-contract.mts`、`tests/agent-adapter.test.mts`：內建 Adapter 與 fixture-only Adapter contract、canonical mapping、mismatch／unknown claim、Generic HTTP observe-only 負向測試。

## Acceptance criteria 對照

| 條件 | 結果 |
|---|---|
| 三個既有 Agent 事件經 Adapter 才進 Event Core | 通過：main 建立 registry，event server 使用 registry normalizer |
| UI 依 runtime capability，不硬編碼 agent 名稱 | 通過：Setup Wizard 使用 `integration-status.adapters` |
| install／uninstall 保持 idempotent 且不破壞其他 hooks | 保留既有 setup merge／repair path；Adapter operations 只做橋接，需使用者實機確認既有設定差異 |
| packaged Windows 使用真實 `node.exe` | 通過架構保留：Adapter operations 呼叫既有 `setup.ts` node resolver，未使用 `process.execPath`；本階段 `pnpm.cmd build` 產生 0.7.1 packaged artifact，隔離 user-data 啟動 sanity 通過；版本升級後未重建 packaged artifact |
| HTTP 204 之外驗證 canonical mapping／renderer state | source-level 通過：registry contract 測試 mapping；Setup Wizard Test 仍使用 live receiver receipt path；完整 packaged renderer 互動仍需 Windows session |
| fixture-only Adapter 不需修改 progression／Tray／HUD／Pet | 通過：fixture contract 只依賴 `AgentAdapter`，未修改產品 projection |

## Capability matrix

| Adapter | Permission | Token | Quota | Health | Install |
|---|---|---|---|---|---|
| OpenCode | `respond`：`allow_once`／`deny` | estimated | none | runtime | plugin installer |
| Codex | `observe` | estimated | provider | runtime | hooks + config |
| Claude Code | `observe` | estimated | provider | runtime | settings hooks |
| Generic HTTP | `none` | none | none | no | local `/v1/events` |

Generic HTTP 的 payload 可以明確選擇 `adapterId: generic-http`，但不能自稱 OpenCode／Codex／Claude Code；無 `adapterId` 的 legacy v1 payload 依 validated source family 做分類，分類只供 projection，不是 permission authority。

## 安全檢查

- Adapter registry 對 `adapterId` 做 enum validation；Generic HTTP 不能自我宣稱具備 built-in adapter capability。
- Event server 既有 loopback、token、Origin rejection、content-type、body/rate limit 與 canonical allowlist 全部保留。
- 新增 IPC 僅允許 trusted panel sender；install／uninstall／diagnose 只接受註冊 Adapter id，Generic HTTP 不可安裝或解除安裝。
- Adapter status／diagnose 只回傳 bounded health text、capability 與檢查結果，不回傳 hook token、完整 path、prompt、tool arguments 或 permission handle。
- setup operations 重用既有 path canonicalization、設定 merge、Windows `node.exe` resolver 與 hook repair；沒有新增 command／callback URL／任意 filesystem ingress。

## 驗證結果

| Gate | 結果 |
|---|---|
| `npx.cmd vue-tsc --noEmit` | 通過 |
| `npx.cmd vite build` | 通過：renderer 47、main 21、preload 2 modules |
| `npm.cmd run test:unit` | 通過，49／49 tests |
| Adapter targeted contract tests | 通過，4／4 tests；包含 fixture-only adapter |
| `pnpm.cmd build` | 通過：版本升級前的 `release\\win-unpacked\\Agent Pets.exe` 與 `release\\AgentPets-0.7.1.exe` 已更新；隔離 packaged startup 通過 |
| `pnpm.cmd audit --prod --audit-level moderate` | `No known vulnerabilities found` |
| high-risk secret scan | 未命中 private key、AWS、GitHub、OpenAI 或 Slack token 樣式 |
| `git diff --check` | 通過 |

## 尚未完成的實機證據與風險

- 目前環境無可用的桌面擷取／CDP page target，尚未把 Setup Wizard 的 runtime capability 卡片與 Test receipt 做成可視化 packaged evidence；不可用 static build 取代該證據。
- 尚未在三個外部 Agent 的實際設定檔上執行 install→diagnose→uninstall round-trip；既有 setup tests 與 adapter bridge 保留原本 merge 邏輯，需使用者 Windows session 以非破壞性備份設定驗證。
- macOS／Linux 的 native hook runner 與 GUI config path 未在 Windows session 實測；不可由 Windows 結果推論。
- 本次只升級版本 metadata，未重跑完整 packaged build；可在需要發布 `0.8.0` artifact 時重新執行 `pnpm.cmd build`。
