# Phase 8 — Per-project Pet

## 目的與範圍

本階段讓同一台電腦上的不同專案可以選擇不同桌寵，同時保留未設定綁定時的既有行為。路由真相由 Electron main process 管理，renderer 只接收清理後的 project basename、匿名 project ID 與 routed pet ID。

已交付：

- canonical project identity：存在的資料夾會 realpath 化，涵蓋 symlink／junction 與 Windows 大小寫差異；
- main-owned SQLite project routing store 與 schema migration；
- optional project → pet binding、解除綁定與缺少寵物 fallback；
- 事件進站時套用路由，Progression／History 分別保存 routed pet 與 project filter；
- Pets 設定卡片的原生資料夾選擇器、綁定選單與修復路徑；
- History 七日 HUD 的 project filter；
- OpenCode generated plugin 將 project path 一併送入受驗證的 event ingress；
- project routing、History isolation、XP isolation 的回歸測試。

## Acceptance criteria

| 條件 | 結果 |
| --- | --- |
| 未設定 binding 時維持 selected pet 行為 | 通過：route 無 binding 時不附加 `routedPetId` |
| path variant／junction 不任意分裂 | 通過：canonical realpath、Windows lowercase、測試涵蓋 `.` 與大小寫變體 |
| event snapshot 使用 routed pet，改 binding 不搬移舊 XP | 通過：Progression routed snapshot 與跨 project session 測試 |
| missing pet fallback 且可修復 | 通過：main fallback 到 `aang-airbender`，UI 顯示缺少並可重新選擇／解除綁定 |
| 通知／MCP status 不洩漏完整路徑 | 通過：event normalizer 只傳 basename；routing DB、view、History summary 不保存 raw path |
| 多 agent 同 project 統一聚合 | 通過：History 使用 project ID filter；相同 project ID 聚合 adapter rows |

## 安全性檢查

- 專案路徑只接受絕對、有限長度、無 NUL／換行的 directory path；不存在的路徑只建立可修復的匿名 identity，不讀寫該路徑。
- project ID 與 pet ID 均以固定白名單驗證；binding 只能選 main process 確認存在的 pet。
- SQLite 只保存 salt、hash、basename、時間與 pet ID；IPC 不回傳 raw path，也不接受 renderer 自行提交路徑做 binding。
- 事件 ingress 先經既有 adapter normalization，再由 main process 產生 `projectId`／`routedPetId`；renderer 或一般 HTTP payload 無法偽造路由欄位。
- History／Progression 以 project route 與 pet scope 做去重，避免跨 workspace session ID 互相污染 XP 或用量。
- project routing storage 建立失敗時，事件仍走既有未綁定 selected-pet 行為，不阻塞桌寵啟動。

## 驗證證據

本階段 gate 證據：

- `node node_modules\\vue-tsc\\bin\\vue-tsc.js --noEmit`：通過；
- `pnpm.cmd test:unit`：通過，84/84；包含 project routing、History isolation、Progression pet snapshot、OpenCode project forwarding 回歸測試；
- `pnpm.cmd exec vite build`：通過；renderer、main、preload 皆成功產出；
- `pnpm.cmd build`：通過；建置前只關閉本專案可辨識的 Agent Pets，產出 `release\\AgentPets-0.9.0.exe` 與 `release\\win-unpacked`；
- packaged Windows smoke：在工作區可寫的暫存 user-data 下，以隔離 user-data、`--no-sandbox --disable-gpu --in-process-gpu --disable-gpu-compositing` 啟動並持續運行；目前受限環境的 `%APPDATA%\\agent-pets`／`%USERPROFILE%\\.desktop-pet` 權限會造成 lock／bridge 寫入 `EPERM`，已改為降級記錄而不阻止主程序。實際使用者帳號仍需有 Electron user-data 與 `.desktop-pet` 寫入權限；
- `pnpm.cmd audit --prod --audit-level moderate`：通過，無已知漏洞；`nanoid` 由 3.3.17 更新至 3.3.18；
- `git diff --check`：通過；changed-file secret scan 未發現高信心 secret pattern；
- `.claude/`：維持 untracked，未修改、未 stage；
- macOS native packaged runtime：本機未執行，不能以 Windows 結果代替。

## 版本 gate 與剩餘風險

本階段新增 main-owned persistent routing store、XP ledger migration 與 public IPC，依專案規則屬於 minor 版本變更；建議在所有 gate 通過且使用者確認後由 `0.9.0` 升至 `0.10.0`，再建立 commit。macOS 實際 native folder picker／packaged runtime 若本機無法執行，需在交付時明確標示為未驗證，而不能以 Windows 結果代替。

剩餘風險：同一 repository 的不同 worktree 會被視為不同 canonical path；這是刻意選擇，避免未經使用者同意把不同工作目錄的 XP 合併。`aang-airbender` 仍是不可移除的 fallback；隱藏內建寵物的 renderer 偏好不會刪除 main process 的可用 pet ID，若使用者希望把已隱藏寵物視為不可綁定，需另列後續設定契約。
