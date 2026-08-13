# Phase 6 驗證報告：Presentation MCP

- 日期：2026-08-13
- 目前版本：`0.8.0`
- 階段狀態：實作與 source gates 完成，等待使用者確認
- 建議版本：`0.9.0`（minor；新增公開的 Presentation MCP contract 與 main-owned Control Plane 安全邊界）

## 階段範圍

本階段把 MCP 限定為「Presentation Channel」：Agent 只能要求桌寵顯示狀態、短暫反應或短訊息，不能藉由 MCP 執行指令、讀寫檔案、批准權限或改變 Event Core 的真實狀態。所有請求仍由 Electron main process 驗證、限流、排隊與過期清理。

## 實作摘要

- `src/types/presentation.ts`：固定 `pet_status`、`pet_react`、`pet_say` 的資料與錯誤 contract。
- `electron/presentation-controller.ts`：main-owned intent controller，包含 payload 清理、pet/TTL/queue 上限、每 client 限流、DND/偏好/高優先狀態阻擋、disconnect 清理。
- `electron/presentation-mcp.ts`：只監聽 `127.0.0.1` 的 token-authenticated HTTP control server；只開放 `/v1/presentation/status`、`/v1/presentation/intents`、`/v1/presentation/disconnect`。
- `integrations/presentation-mcp.mjs`：stdio JSON-RPC MCP bridge，只暴露三個工具；使用真正的 `node.exe` 執行，不使用 packaged Agent Pets `.exe` 當 Node interpreter。
- `electron/setup.ts`：建立 user-data 下的獨立 token 與 MCP bridge script；token 不進 renderer、status 或 log。
- renderer：短訊息與反應使用既有 optional reaction 層及 Liquid Glass bubble；權限要求、等待輸入、錯誤等高優先狀態不會被 Presentation intent 蓋掉。
- settings/tray/docs：Presentation MCP 是獨立開關，不與一般 Bubble 或權限泡泡共用。
- README：補上 Codex、Claude Code、OpenCode 的 stdio bridge 接通步驟、重啟與排錯說明。
- build preflight：`scripts/stop-agent-pets.mjs` 只清理本專案可由 executable path／workspace command line 證明的 Agent Pets，避免 packaged build 的檔案鎖定。
- `electron/project-mcp-setup.ts`：由設定頁一鍵選取本機專案，安全、可重複地寫入三個 project-local MCP 設定；同名衝突一律保留原檔，不執行 shell 或改全域設定。
- `electron/project-mcp-registry.ts`：在 Agent Pets user-data 保存已連接專案清單；設定頁會重新檢查三個 client，顯示 connected／partial／conflict／missing，並提供只移除 Agent Pets 自己且內容未被修改之項目的安全操作。

## Acceptance criteria

| 驗收項目 | 結果 |
|---|---|
| MCP 僅能提出 presentation intent | 通過；bridge 與 server 均為固定三工具/三路由，沒有 command、file、permission route |
| 訊息為純文字且有長度上限 | 通過；NFKC、控制字元/標記清理、240 字上限，並以 Vue interpolation 顯示 |
| TTL、queue、client rate limit 有界 | 通過；TTL 1–15 秒、main queue 32、renderer queue 8、每 client 3 次/10 秒 |
| DND/關閉開關可阻擋 presentation | 通過；main controller 及 renderer 皆 fail closed，偏好或 DND 變更會清除 pending |
| 高優先狀態不被覆蓋 | 通過；permission、waiting-input、error 等狀態優先；presentation 請求不會批准或拒絕權限 |
| Agent disconnect 後清除請求 | 通過；disconnect route、stdio EOF/signal 與 controller cleanup 均覆蓋 |
| 不改變 XP、quota、Event Core 真實狀態 | 通過；Presentation 僅為投影/短暫 UI channel，未接入 progression、permission authority 或 quota truth |
| 設定頁一鍵安裝 project-local MCP | 通過；原生資料夾選擇器後寫入 Codex／Claude Code／OpenCode 三種設定，既有相同設定 idempotent、衝突不覆蓋 |
| 多專案清單與安全移除 | 通過；user-data registry 保存多筆 project-local 路徑，開啟設定頁重新檢查三個 client；移除只處理內容仍匹配的 Agent Pets entry，修改過的項目保留並標示衝突 |

## 安全性檢查

- HTTP server 綁定 loopback `127.0.0.1`，使用獨立 64 hex token，並拒絕 browser `Origin` 請求。
- token 使用 constant-time comparison；HTTP body、content type、method、global rate limit 均有檢查。
- client id、pet id、kind、reaction、TTL、message 均採 allowlist/上限驗證；全域 pending 與每 client pending 皆有界。
- IPC 的 presentation status 僅接受可信任 pet window sender；renderer 不接觸 token。
- stdio bridge 僅能呼叫固定 loopback presentation endpoint；沒有任意 URL、callback URL 或 shell execution 欄位。
- Project MCP installer／registry 只接受 main process 原生資料夾選擇結果，限制設定檔與 registry 大小，拒絕 symlink／不安全目錄，使用原子寫入，並在同名設定衝突或移除前內容改變時 fail closed。
- UI 不使用 `v-html`；DND、權限泡泡與高優先 notice 的安全邊界維持不變。
- `pnpm.cmd audit --prod --audit-level moderate`：`No known vulnerabilities found`。
- high-risk secret scan：未發現 private key、GitHub/OpenAI/Slack token 等高風險模式。

## 驗證 gates

依賴環境恢復後，source gates 已重新執行；既有安全 gates 也保留先前的通過證據：

| Gate | 結果 |
|---|---|
| `pnpm.cmd test:unit` | 通過，68/68；包含 build preflight 的 5 個程序邊界測試與 registry／installer 的 8 個多專案、安全／冪等測試；stdio 測試使用動態測試埠，不會與正在執行的 Agent Pets 正式埠互撞 |
| `pnpm.cmd exec vue-tsc --noEmit` | 通過 |
| `pnpm.cmd exec vite build`（由完整 build 執行） | 通過；renderer 48 modules、main 27 modules、preload 2 modules |
| `node.exe --check integrations/presentation-mcp.mjs` | 通過 |
| `node.exe --check scripts/stop-agent-pets.mjs` | 通過 |
| `node.exe --test ... tests/project-mcp-setup.test.mts tests/project-mcp-registry.test.mts` | 通過，8/8；涵蓋多專案清單、missing folder、forget、匹配移除、衝突保留、安裝冪等與安全路徑驗證 |
| targeted stdio MCP test | 通過 |
| targeted controller test | 通過 |
| `pnpm.cmd audit --prod --audit-level moderate` | 通過 |
| high-risk secret scan | 通過 |
| `git diff --check` | 通過 |
| `pnpm.cmd build` / packaged Windows runtime | 通過；最新 prebuild 找不到本專案執行中的 Agent Pets，產出 `release\\AgentPets-0.8.0.exe` 與 `release\\win-unpacked\\Agent Pets.exe`，並包含目前的 registry／strict removal 變更 |

## 封裝 gate 與環境修復

先前失敗是多個環境條件疊加，而不是 Phase 6 source error：執行中的 Electron 程序鎖住 `node_modules`、中斷安裝留下不完整的 linking、pnpm store 設定不一致造成 SQLite collector 問題，以及 Electron 43.3.0 binary 未完成 postinstall。後續重現又確認 production-only 修復路徑曾把 `package.json` 與 lockfile 縮成只含 runtime dependencies，導致 `pnpm build` 再次觸發自動安裝。這次已完成以下修復：

- 關閉所有指向本專案的 Agent Pets Electron 程序。
- 依 `pnpm-lock.yaml` 以離線模式重建 336 個套件，並把 pnpm store 固定到使用者層級 `C:\Users\dgh\AppData\Local\pnpm\store\v11`；設定不寫入專案。
- 還原完整的 `package.json` scripts/devDependencies/electron-builder 設定與 `pnpm-lock.yaml`，保留 Phase 6 的 `presentation-mcp.mjs` resource filter。
- 驗證 Electron 43.3.0 zip 的 SHA-256 checksum，重新執行 package postinstall，恢復 `node_modules\\electron\\dist\\electron.exe`。
- 重新執行完整 `pnpm.cmd build`，Vite、native dependency rebuild、electron-builder 與 portable artifact 均通過。
- `release\\win-unpacked\\Agent Pets.exe` 使用隔離 user-data 及正常 user-data 各啟動 8 秒，程序均維持 responding，之後已關閉。
- 將程序清理固定成 `prebuild`／`preelectron:build`，並加入 fail-closed path matching 與 taskkill race re-check；不會以名稱廣泛終止其他 Electron 或 `pnpm dev`。
- 將本次 pnpm store、Electron postinstall、production-only 修復風險與 gate 流程寫入 `.agents/skills/pet-skill/references/build-environment.md`，供後續 Phase 使用。

第一次以 Codex 普通沙箱啟動正式 user-data 時會被沙箱拒絕建立 Electron singleton lock；這不是應用程式 ACL 或產物錯誤，獲准的正常 user-data sanity check 已通過。現有 `release` 舊版 artifact 不包含 Phase 6，因此不作為本階段證據。

## 尚存風險與下一步

- Windows packaged artifact 與啟動已通過；仍需要在實際使用者桌面 session 完成 MCP stdio round-trip、DND/權限優先序與 Tray 行為驗證。
- macOS/Linux 的 native notification、tray 與 user-data 路徑仍未在本階段驗證。
- MCP client 必須明確指定真正的 Node executable 與 user-data 下的 `presentation-mcp.mjs`；不要把 Agent Pets packaged `.exe` 當作 Node。
- `Get-CimInstance Win32_Process` 在部分受限 Windows session 可能回傳權限錯誤；preflight 會改用較窄的 `Get-Process` path 查詢，若仍無法確認程序歸屬則 fail closed，不會擴大終止範圍。
- 新增功能的繁體中文文案與完整 i18n 仍需按後續 Phase 補齊；本次已把它提升為 skill、roadmap 與 README 的跨階段要求。
- 本報告只代表 `0.8.0` 工作樹的 Phase 6 source implementation；待使用者確認後才升版至 `0.9.0` 並提交 commit。
