# 效能與安全性重構（v1.2.2）

## 範圍

針對 main process 熱路徑與 renderer store 的演算法／I/O 瓶頸做重構，並修正事件轉送的可靠性缺陷。不改變持久化 schema、IPC 合約或安全邊界。

| 檔案 | 問題 | 處理 |
|---|---|---|
| `electron/local-usage.ts` | 每行都 `JSON.parse`；Codex 行在找到 cwd 前重複解析兩次；每行 `Buffer.byteLength` O(n)；每筆紀錄各自開 SQLite transaction；每個檔案 `lstat` 兩次 | 子字串預篩後才解析、每行最多解析一次；以 UTF-16 長度上下界 O(1) 判斷行大小；每個檔案合併成單一 transaction；重用走訪時的 stat |
| `electron/history.ts` 等 4 個 SQLite store | 每次呼叫都 `prepare()` 重新編譯 SQL | 新增共用 `StatementCache`（`electron/sqlite-statements.ts`） |
| `electron/history.ts` | transaction 不可重入 | 可重入 transaction 與 `batch()`，最外層統一 COMMIT／ROLLBACK |
| `electron/permission-broker.ts` | `activeRequests()` 每次 O(n log n) 排序；`createRequest` 再 `findIndex` 一次；呼叫端只要布林值卻建立全部 view | 依 Map 插入順序（即 order）O(n) 收集；新請求位置直接等於佇列長度；新增 `hasActiveRequests()`／`isRequestActive()` |
| `electron/main.ts` | 拖曳輪詢等 3 處以 `listRequests().length` 判斷；事件轉送未略過已銷毀視窗，`send` 拋錯會讓通知／XP／歷史整個被跳過並回 400 | 改用 `hasActiveRequests()`；過濾 `isDestroyed()` 視窗 |
| `electron/event-server.ts` | 使用 Node 預設 60s／300s 逾時 | `headersTimeout` 10s、`requestTimeout` 15s |
| `electron/project-routing.ts` | 路徑快取命中時未更新順序（註解自稱近似 LRU） | 命中時移到尾端，成為 O(1) LRU |
| `src/stores/agentStore.ts` | session 淘汰整體排序只取最小值；成就定義每次 `find`；`visiblePets` 為 O(n·m) | 單次線性掃描（保留相同 tie-break）；`Map` 查表；`Set` 過濾 |

## 量測

合成 5 個 Claude JSONL 檔、共 10 萬行（2 萬筆 usage），以 `LocalUsageReader.scan()` 冷匯入：

| 版本 | 耗時（兩次） |
|---|---|
| 重構前 | 12,253 ms／11,371 ms |
| 重構後 | 1,088 ms／1,262 ms |

匯入筆數一致（20,000／20,000）。

## Pinia Colada 評估

不引入。Renderer 沒有任何 HTTP `fetch`，資料主要由 main process 以 IPC 主動推送，僅有 4 個一次性 IPC 讀取（`getQuotaUsage`、`listProjectPets`、`getProjectPetsEnabled`、`getPowerSaveState`）。Pinia Colada 提供的查詢快取、stale-while-revalidate 與重試在此架構下沒有對應需求，引入只會增加依賴與間接層。

## 驗證

- `pnpm exec vue-tsc --noEmit`：通過
- `pnpm run test:unit`：118／118 通過（新增 broker helper、StatementCache、巢狀 batch 回滾 3 個測試）
- `pnpm exec vite build`：通過
- `git diff --check`：通過

## 殘餘風險

- 未啟動 Electron GUI 手動走 golden path；需使用者確認寵物視窗、面板 Usage／History、Permission 泡泡顯示正常。
- 預篩依賴 JSONL 以字面字串輸出 `"assistant"`、`"usage"`、`"token_count"`、`"session_meta"`；若產生器改用 unicode escape 會漏算（目前 Claude／Codex 皆未如此）。
- Permission Broker 為了 anti-replay 保留終態紀錄，單次執行累計 5,000 筆請求後會 fail closed（`capacity_exceeded`）。這是既有設計且有測試保護，本次未更動，建議後續評估改為依時間淘汰終態紀錄。
- `permission-adapter-server` 的外部 key 對照表也不會清除；受每分鐘 60 次限制，長時間執行才會累積。

## 版本

Patch：1.2.1 → 1.2.2（使用者已明確同意升版）。
