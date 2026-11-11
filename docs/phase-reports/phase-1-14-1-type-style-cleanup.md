# 1.14.1 型別與風格清理

- **基準 commit**：`79e3704`（`main`，版本 1.14.0）
- **階段順序**：G0 → A → B → C → D → E → F，每階段一個分支，下一階段從上一階段切出；最後統一升 patch 版（1.14.1）。
- 本檔由各階段依序續寫，每階段一節。

## G0：Windows 無法建立 symlink 的測試

- **分支**：`claude/cleanup-g0-symlink-tests-8871b0`
- **開始時間**：2026-11-11 11:35（Asia/Taipei）
- **完成時間**：2026-11-11 11:45（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範、盤點 6 個失敗測試與受測程式碼 | 通過 | 5 個目錄連結、2 處檔案連結（其中 1 個測試兩者都有） |
| 2 | 共用 helper 與測試調整 | 通過 | `linkDirectory`；目錄改 junction、檔案掛 skip |
| 3 | junction 判定負向對照 | 通過 | 實測 `lstat`／`Dirent`／`realpath` 對 junction 的回報與目錄 symlink 一致 |
| 4 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit` | 通過 | 第一次全量出現 `atomic-write-call-sites` 偶發失敗，修正後連續兩次全量 0 fail |
| 5 | code review（現代 TS 寫法、pet-skill 規則）與 commit | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `tests/support/fs-capabilities.mts` | 新增 `linkDirectory(target, link)`，以 `'junction'` 建立目錄連結 | 目錄連結測試共用一個免權限的建立方式，不在各測試重複寫 |
| `tests/hook-config.test.mts` | symlinked dotfile 測試掛 `SKIP_WITHOUT_FILE_SYMLINKS` | 檔案 symlink 無免權限替代品 |
| `tests/permission-adapter-server.test.mts` | `linked` 目錄改用 `linkDirectory`；建立目錄與連結移進 `try` | 讓整個測試在 Windows 執行；建立失敗時也清掉暫存目錄 |
| `tests/pet-import.test.mts` | 兩處目錄 symlink 改用 `linkDirectory`，移除未再使用的 `symlinkSync` import | 讓 recovery 與 staging root 的安全測試在 Windows 執行 |
| `tests/project-mcp-setup.test.mts` | `link.git` 改用 `linkDirectory`；info／exclude 測試拆成兩個，exclude 那個掛 skip | 目錄部分照常執行，只略過需要檔案 symlink 的斷言 |
| `tests/plugin-developer-mode.test.mts` | 自寫的 `symlinkSync(..., 'junction')` 改用 `linkDirectory` | 抽共用，避免重複 |
| `tests/atomic-write-call-sites.test.mts` | 新增 `onlyTemporaryPath()`，三處「rename 次數」斷言改為「不重複暫存路徑恰為 1」（EBUSY 重試那個改成次數 ≥ 2 且同一路徑） | 全量測試時偶發失敗（見下方「範圍內順手修正」），斷言改測真正要固定的性質 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增，建立 G0 一節 | 階段紀錄，後續階段續寫 |

### 問題

這台 Windows 機器沒開開發者模式，`fs.symlinkSync` 回 `EPERM`，`pnpm test:unit` 有 6 個測試失敗，讓之後每個階段都沒有乾淨的測試基準：

| 檔案 | 測試 | 連結種類 |
|---|---|---|
| `tests/hook-config.test.mts` | removing hooks from a symlinked dotfile keeps the link and its target | 檔案 |
| `tests/permission-adapter-server.test.mts` | a file edit is medium only inside the project and never for execution-relevant paths | 目錄 |
| `tests/pet-import.test.mts` | startup recovery restores interrupted replaces and removes only our own stale entries | 目錄 |
| `tests/pet-import.test.mts` | a symlinked staging root is refused | 目錄 |
| `tests/project-mcp-setup.test.mts` | git helpers never follow gitdir or commondir outside the picked folder | 目錄 |
| `tests/project-mcp-setup.test.mts` | git helpers refuse a symlinked info directory or exclude file | 目錄＋檔案 |

### 改了什麼（說明）

1. `tests/support/fs-capabilities.mts` 新增 `linkDirectory(target, link)`：一律以 `'junction'` 型別建立目錄連結。Windows 上 junction 不需要開發者模式；其他平台 Node 會忽略這個型別，照常建立目錄 symlink，所以 macOS／Linux 的測試行為不變。
2. 目錄連結（5 個測試）改用 `linkDirectory`，在 Windows 也真正執行，不 skip。
3. 檔案連結：
   - `hook-config` 那個測試掛 `{ skip: SKIP_WITHOUT_FILE_SYMLINKS }`。
   - `project-mcp-setup` 的「info directory or exclude file」拆成兩個測試：「refuse a symlinked info directory」（junction，照常執行）與「refuse a symlinked exclude file」（檔案 symlink，掛 skip）。原本兩段斷言完全保留，只是後一段改在自己的暫存目錄裡重建 `.git/info`，不再依賴前一段刪掉連結的步驟。
4. `permission-adapter-server` 的測試原本混了 symlink 與非 symlink 斷言；改用 junction 後整個測試都能執行，因此不需要拆。順便把建立目錄與連結移進 `try`，原本這幾行在 `try` 外，失敗時暫存目錄不會被清掉。
5. `tests/plugin-developer-mode.test.mts` 原本自己寫 `fs.symlinkSync(source, linked, 'junction')`，改用共用的 `linkDirectory`，避免兩處各寫一份。

### 為什麼目錄可以用 junction

這些測試驗證的安全性質是「受測程式碼不跟隨連結」。受測程式碼判斷連結的方式：

- `electron/pet-import.ts`：`lstat().isSymbolicLink()`／`isDirectory()`（staging root、recovery 逐項檢查）。
- `electron/git-tracking.ts`：`lstatSync().isSymbolicLink()`（`.git/info`）與 `realpathSync`（gitdir／commondir 是否在專案外）。
- `electron/permission-risk.ts`（經 `permission-adapter-server.ts`）：`realpathSync.native` 解析最近存在的祖先目錄。

在本機實測 Node 對 junction 的回報與目錄 symlink 相同：`lstat().isSymbolicLink() === true`、`isDirectory() === false`、`readdir` 的 `Dirent.isSymbolicLink() === true`、`realpathSync` 與 `realpathSync.native` 都解析到目標。因此用 junction 時測試仍在驗證同一個性質；若受測程式碼沒偵測到連結，這些測試會因為寫穿到外部目錄或風險等級錯判而失敗，不會意外通過。

檔案沒有不需權限的連結替代品（hard link 不是 reparse point，`lstat` 不會回報為連結，會改變測試語意），所以只能 skip。

### 範圍內順手修正：`atomic-write-call-sites` 的偶發失敗

第一次全量 `pnpm test:unit` 時，6 個 symlink 失敗已消失，卻多出 1 個不在清單上的失敗：`desktop-preferences writeJsonAtomic …: temporary file name format is stable`（`2 !== 1`）。單獨重跑該檔 5 次都通過，屬於偶發。

原因：測試攔截 `fs.renameSync`，每看到一次 `.tmp` 來源就記一筆，再斷言筆數為 1。但 `electron/fs-rename.ts` 的 `renameSyncWithRetry` 在 Windows 遇到暫時性 `EPERM`／`EBUSY`（全量並行時防毒或索引程式短暫鎖檔）會以同一個暫存路徑重試，同一個暫存檔就被記了兩次。這是受測程式碼刻意的正確行為，錯在斷言量的是 rename 次數。

測試想固定的是「一次寫入只用一個暫存檔，且名稱格式穩定」，所以改成比對不重複的暫存路徑數；EBUSY 注入那個測試原本要求「恰好 rename 2 次」，改成「至少 2 次且都是同一路徑」，仍證明注入的 EBUSY 之後有重試同一個暫存檔。斷言沒有放寬：若實作改成每次重試換新暫存檔或一次寫入用兩個暫存檔，仍會失敗。三處共用 `onlyTemporaryPath()`，不各寫一份。

### 驗證

| 檢查 | 基準（`79e3704`） | G0 之後 |
|---|---|---|
| `pnpm lint` | 0 error、52 warning（`no-explicit-any`） | 0 error、52 warning，未新增；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1811 項：6 fail、37 skip | 1812 項：1773 pass、0 fail、39 skip（連續兩次全量相同） |
| `git diff --check` | — | 通過 |

- 測試數 +1：`project-mcp-setup` 的 info／exclude 測試拆成兩個。
- skip +2：`hook-config` 的 symlinked dotfile、`project-mcp-setup` 的 symlinked exclude file，皆顯示 `# file symlinks need Developer Mode or elevated privileges on Windows`。
- 原本失敗的 5 個目錄連結測試以 junction 在本機實際執行並通過。
- 負向對照：本機實測 junction 的 `lstat().isSymbolicLink() === true`、`isDirectory() === false`、`Dirent.isSymbolicLink() === true`、`realpathSync`／`realpathSync.native` 解析到目標。
- code review（現代 TS 寫法、pet-skill 規則）：改動只在 `tests/` 與本報告，不觸及 renderer、IPC、hook 或任何信任邊界；沒有放寬斷言；連結建立與暫存路徑檢查各抽成一個共用函式；註解只寫原因且為繁體中文；新增函式有明確回傳型別、參數用 `readonly string[]`；`!` 只用在已斷言長度之後。無 Liquid Glass／視覺變更，不需視覺閘門。

### 殘留風險

- 兩個檔案 symlink 測試在沒有開發者模式的 Windows 上是 skip，該行為只在 macOS／Linux 或開了開發者模式的 Windows 上被驗證。
- junction 與目錄 symlink 在 Windows 上仍有差異（junction 只能指向本機絕對路徑、不能指向檔案或網路路徑）；受測程式碼目前的判斷只用到兩者一致的部分，日後若改用 `readlink` 的原始字串或依賴相對目標，需要重新檢查。
- `atomic-write-call-sites` 的偶發失敗只觀察到一次，原因是依 `renameSyncWithRetry` 的重試行為推定（單獨跑 5 次、修正後全量 2 次都通過），未直接捕捉到當次的 `EPERM`／`EBUSY`。
- 本機只在 Windows 執行；macOS／Linux 上 `'junction'` 被忽略的行為依 Node 文件推定，未在本階段實機驗證。

## A：renderer 收 agent 狀態事件路徑上的 `any`

- **分支**：`claude/cleanup-a-renderer-any-e2cedd`
- **開始時間**：2026-11-11 03:55（Asia/Taipei）
- **狀態**：通過
- **完成時間**：2026-11-11 03:57（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範、追 `agent-status-event` 從 main 到 renderer 的路徑 | 通過 | 唯一送出點是 `electron/event-server.ts` 的批次 `webContents.send` |
| 2 | 型別對齊：`electron-api.ts`、`preload.ts` | 通過 | 執行期驗證仍在 main 的 `event-normalizer`，未變動 |
| 3 | 移除 `App.vue`、`useRealEventWait.ts` 的 `any`／手動斷言 | 通過 | |
| 4 | 掃 `src/**` 其他 `any` | 通過 | 只剩一處英文註解裡的 "any" 字樣，非型別 |
| 5 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit`、code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `src/types/electron-api.ts` | `onAgentStatusEvent` 的 callback 參數由 `any` 改為 `AgentStatusEvent` | main 只送正規化後的 `AgentStatusEvent`，型別應反映實際契約 |
| `electron/preload.ts` | callback 型別改為 `AgentStatusEvent`，`data` 標為 `AgentStatusEvent \| AgentStatusEvent[]`；加註說明驗證在 main | 與 `ElectronAPI` 對齊；preload 不做驗證，避免讀者誤以為型別等於檢查 |
| `src/App.vue` | `(window as any).electronAPI` 改為 `window.electronAPI`（`env.d.ts` 已宣告為 optional，保留 `?.`）；`store.handleEvent(event)` 不再 `as any` | 移除 2 個 `any`；改用全域宣告後，同一區塊其他 `electronAPI.*` 呼叫也開始受型別檢查（`vue-tsc` 0 error） |
| `src/composables/useRealEventWait.ts` | 移除 `raw: unknown` 與 `raw as {...}` 手動斷言，直接用推導出的 `AgentStatusEvent`；拿掉 `!event?.source` 檢查 | `source` 在型別上必填，且 normalizer 會拒絕缺少或不合法的 `source` |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 A 一節 | 階段紀錄 |

### 事件契約確認

- main → renderer 只有一個送出點：`electron/event-server.ts` 的 `enqueueAgentEvent` 批次回呼，送出 `AgentStatusEvent[]`。
- 進入 `sendToWindows` 的事件只有兩個來源：HTTP ingress 經 `normalizeAgentStatusEvent`（拒絕非字串或不在 `VALID_SOURCES` 的 `source` 等），以及主程序自產、以 `AgentStatusEvent` 型別傳入的 dispatcher 事件。
- preload 仍保留「陣列或單筆」的攤平邏輯，執行期行為不變；main 端驗證未因型別變更而省略。

### Code review 結論

- 只改型別與移除斷言，沒有改變執行期行為（除 `useRealEventWait` 拿掉一個依契約不會成立的 `!event?.source` 防禦）。
- 不碰 B～F 範圍：未動 `electron/quota.ts`、`value-guards.ts`、`setup.ts`，也未調整 eslint 規則層級。
- `src/**` import 仍為 `@/`；`preload.ts` 是 electron 端，沿用相對路徑。新增註解為繁體中文且只寫原因。
- `useRealEventWait.ts` 的 `AgentSource` import 仍被 `WaitableTool` 使用，無多餘 import。
- 無 Liquid Glass／視覺變更，不需視覺閘門。

### 驗證

| 檢查 | G0 之後 | A 之後 |
|---|---|---|
| `pnpm lint` | 0 error、52 warning（`no-explicit-any`） | 0 error、49 warning（皆為 `no-explicit-any`，全在 `tests/`、`electron/`；`src/` 0 個）；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1812 項：1773 pass、0 fail、39 skip | 1812 項：1773 pass、0 fail、39 skip |
| `git diff --check` | 通過 | 通過 |

### 殘留風險

- 型別現在宣稱 renderer 收到的一定是 `AgentStatusEvent`；若日後新增一條繞過 `event-normalizer` 的送出路徑，型別不會攔住，需在 main 端維持「只送正規化事件」的不變式。
- `electron/event-server.ts` 送出時寫死字串 `'agent-status-event'`，未用 `IPC_CHANNELS.agentStatusEvent`；兩者目前一致，但不在 A 的 renderer 範圍，留給 D（風格統一）處理。
- 本階段沒有 renderer 端的自動化測試覆蓋 `App.vue`／`useRealEventWait` 的事件接收；正確性依 `vue-tsc` 與既有行為推定，未啟動 app 實機驗證。

## B：主程序共用值守衛與 `quota.ts` 的 `any`

- **分支**：`claude/cleanup-b-value-guards-96b4de`
- **開始時間**：2026-11-11 12:01（Asia/Taipei）
- **狀態**：通過
- **完成時間**：2026-11-11 12:18（Asia/Taipei）

### 步驟狀態

| # | 步驟 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 讀規範，盤點 `quota.ts` 的 10 處 `any` 與指定的手寫守衛 | 通過 | `window-controls.ts` 實際有 5 處（多了 `petContentHeight`），一併替換 |
| 2 | quota characterization 測試（改動前先在原始碼跑綠） | 通過 | `tests/quota-parsing.test.mts` 8 項 |
| 3 | `value-guards.ts` 新增 `asRecord`、`recordOrEmpty`，並補單元測試 | 通過 | `tests/value-guards.test.mts` 3 項 |
| 4 | `quota.ts` 改用 `Record<string, unknown>`，數字欄位改用 helper | 通過 | 10 處 `any` 全數移除 |
| 5 | 替換指定檔案的手寫守衛，補陣列 payload 回歸斷言 | 通過 | 見「陣列 payload 的行為差異」 |
| 6 | Haiku 掃 `electron/**`、`integrations/**`；Sonnet 替換等價守衛 | 通過 | 共 79 處，只換語意與 `isRecord` 完全一致的 29 處（23 個檔案） |
| 7 | `pnpm lint`、`vue-tsc --noEmit`、`pnpm test:unit`、code review | 通過 | 見「驗證」 |

### 檔案變更

| 檔案 | 變更內容 | 原因 |
|---|---|---|
| `electron/value-guards.ts` | 新增 `asRecord(value): Record<string, unknown> \| null` 與 `recordOrEmpty(value): Record<string, unknown>`，判斷都交給 `isRecord` | 各處不必再手寫「是物件且不是陣列」的斷言 |
| `electron/quota.ts` | 拿掉本地的 `asObject`，改用 `asRecord`；`requestJson`、`loadCodexCredential`、`codexNeedsRefresh`、`parseCodexUsage`、`parseClaudeUsage`、`readClaudeCliUsage` 改用 `Record<string, unknown>`；`limit_window_seconds`、`reset_at`、`expiresAt` 改用本地的 `coercedFiniteNumber` | 移除 10 處 `any`，數字欄位不用 `as number` 斷言 |
| `electron/local-usage.ts` | 拿掉本地的 `asObject`，10 處呼叫改用 `asRecord` | 重複邏輯抽共用 |
| `electron/ipc/window-controls.ts` | 5 個 handler 的 `payload && typeof payload === 'object' ? … : {}` 改為 `recordOrEmpty(payload)` | 同上，陣列不再被當成物件 |
| `electron/ipc/pet-motion.ts` | drag-end 改為 `asRecord(payload)?.moved === true`；shimeji walk 改用 `recordOrEmpty` | 同上 |
| `electron/history-sessions.ts` | 查詢改用 `recordOrEmpty(input)`，cursor 改用 `asRecord(raw.cursor)` | 同上；cursor 原本沒排除陣列 |
| `electron/preload.ts` | `onServerHealthChanged`、`onPanelOpened` 改用 `asRecord` | 同上（preload 由 Vite 打包，沿用該檔不帶副檔名的 import 寫法） |
| `electron/transcript-turn-end.ts` | Codex 的 `record.payload as { type?: unknown } \| null` 改為 `asRecord(record.payload)?.type`；`turnEndFromTail` 的手寫守衛改用 `asRecord` | 拿掉沒檢查就斷言的寫法 |
| `electron/agent-adapter.ts`、`event-normalizer.ts`、`history.ts`、`permission-adapter-server.ts`、`permission-broker.ts`、`plugin-badges.ts`、`plugin-catalog-updates.ts`、`plugin-data-file.ts`、`plugin-panel-validation.ts`、`plugin-secret-consent.ts`、`plugin-settings.ts`、`presentation-controller.ts`、`safe-config-write.ts`、`session-jump.ts`、`ipc/panel-theme.ts`、`ipc/permission.ts`、`ipc/plugin-panel-ui.ts`、`ipc/project-mcp.ts`、`ipc/project-pets.ts`、`ipc/session-jump.ts`、`main/plugin-runtime.ts`、`main/runtime.ts` | 掃描找到的等價寫法（`!x \|\| typeof x !== 'object' \|\| Array.isArray(x)` 與 `x && typeof x === 'object' && !Array.isArray(x) ? x as Record : {}`）改用 `isRecord`、`asRecord`、`recordOrEmpty`，並刪掉守衛之後多餘的 `as Record<string, unknown>` | 原本就排除陣列，替換後行為完全相同 |
| `scripts/generate-ipc-inventory.mjs` | 「型別」偵測也認 `isRecord`、`asRecord`、`recordOrEmpty`，`isRecord` 不另列在 helper 欄 | 不改的話，安全清單有 5 列會從「型別」退回通用描述，驗證資訊變少 |
| `docs/security/ipc-inventory.md` | 重新產生；只有 `quota-usage` 一列多了新測試檔 | `tests/ipc-inventory.test.mts` 會比對產生結果 |
| `tests/quota-parsing.test.mts` | 新增 8 項 characterization：Codex／Claude 解析（字串數字、標籤、reset、32 個上限、scoped limits），以及端到端憑證流程（Codex refresh 寫回內容、API-key 模式、壞掉的 root、Claude 憑證檔的到期與方案） | 原本只有零星的解析測試，憑證讀取完全沒有覆蓋 |
| `tests/value-guards.test.mts` | 新增：三個守衛對 null、undefined、陣列、原始型別、函式、一般物件、`Object.create(null)` 的結果；`recordOrEmpty` 每次回傳新物件 | value-guards 有改動 |
| `tests/ipc-window-controls.test.mts`、`ipc-pet-motion.test.mts`、`history-sessions.test.mts`、`transcript-turn-end.test.mts` | 補斷言：payload 不是一般物件（包括帶了同名欄位的陣列）時，不觸發任何動作 | 固定陣列 payload 的新行為 |
| `docs/phase-reports/phase-1-14-1-type-style-cleanup.md` | 新增 B 一節 | 階段紀錄 |

### `quota.ts` 行為不變的細節

- `asRecord` 的判斷（`Boolean(value) && typeof value === 'object' && !Array.isArray(value)`）和原本 `asObject` 的 `value !== null && …` 結果相同：`typeof` 為 `'object'` 的值裡，只有 `null` 是 falsy。
- `coercedFiniteNumber` 等於原本的「`Number(x)` 再加 `Number.isFinite`」，字串 `"18000"` 一樣會被認得。它刻意留在 `quota.ts` 當本地函式：不和 `main/runtime.ts` 只收 `number` 的 `finiteNumber` 合併，也不放進 value-guards，免得 IPC 驗證誤用這個會轉型的版本。`duration === 18_000` 這類比較裡，原本的 `NaN` 現在變成 `undefined`，兩者都不等於任何常數，結果相同。
- 容錯、clamp、預設值、每個 provider 32 個視窗的上限、`requestJson` 的 endpoint 白名單與回應大小上限，全都沒改。
- 憑證讀取的欄位沒變：`OPENAI_API_KEY`、`tokens.access_token/accessToken`、`refresh_token/refreshToken`、`account_id/accountId`、`last_refresh`、`claudeAiOauth.accessToken/expiresAt/subscriptionType/rateLimitTier`。refresh 寫回的欄位也沒變：`last_refresh` 與 `tokens.access_token/refresh_token/id_token`，其他欄位原樣保留。characterization 測試直接比對寫回的整份 `auth.json`、refresh request body 和 Authorization header，改動前後都通過。

### 陣列 payload 的行為差異

下列地方原本只檢查 `typeof === 'object'`，沒有排除陣列：`window-controls.ts`（5 處）、`pet-motion.ts`（2 處）、`history-sessions.ts` 的 cursor、`preload.ts`（2 處）、`transcript-turn-end.ts` 的 Codex payload。改用 `asRecord`／`recordOrEmpty` 之後，陣列一律當成 `null` 或 `{}`。

- 這些地方後面只讀具名欄位（`ignore`、`release`、`height`、`width`、`pinned`、`modal`、`moved`、`deltaX`、`lastSeenAt`、`id`、`servers`、`restore`、`type`），不讀 `length` 也不讀索引。一般陣列本來就沒有這些欄位，讀到的一直是 `undefined`，所以行為不變。
- 唯一的差異：陣列上另外掛了同名欄位時（例如 `Object.assign([], { height: 40 })`，Electron IPC 的 structured clone 可能保留這種欄位），原本會被採用，現在會被忽略。這只會讓驗證更嚴格，不會放寬；正常的 renderer 不會送這種 payload。新增的測試固定了這個行為。
- `transcript-turn-end` 讀的是 `JSON.parse` 的結果，JSON 陣列不可能有具名欄位，所以完全等價。

### 掃描結果與刻意不換的地方

Haiku 掃描 `electron/**` 與 `integrations/**`（已知清單除外），共找到 79 處：`electron/` 74 處、`integrations/` 5 處。只替換語意與 `isRecord` 完全一致的 29 處，其餘不換：

- `integrations/*.mjs`（5 處）：這些是獨立執行的 hook 腳本，不能 import electron 檔案。
- `electron/setup.ts`（2 處）：屬於 C 階段的範圍。
- `error && typeof error === 'object' && 'code' in error` 這類錯誤碼判斷（約 20 處）：用途是把型別收窄成帶 `code` 的物件，不是讀 record；換掉反而會失去 `in` 帶來的收窄。
- `isJsonValue`（`plugin-broker.ts`、`plugin-ui-messages.ts`、`plugin-panel-view.ts`）：在這裡陣列是合法值。
- 原本沒排除陣列、換掉會改變語意的地方：`agent-adapter-operations.ts`、`desktop-notifications.ts`、`diagnostics/redact.ts`、`ipc/adapters.ts`、`ipc/pet-assets.ts`、`ipc/reliability.ts`、`ipc/history.ts:118`、`ipc/plugin-panel-ui.ts` 的 viewport、`main/panel-theme-cache.ts`、`main/db-recovery.ts`、`permission-adapter-server.ts:485` 等。這些不在本階段指定的清單內，不擴大範圍。
- `permission-audit.ts:40`：子代理換成 `isRecord` 之後，`vue-tsc` 報 TS2352。後面的 `value as PermissionAuditRecord` 原本是靠收窄成 `object` 才能成立，換成 `Record<string, unknown>` 就斷言不過去。要通過只能寫 `as unknown as`，等於掩蓋問題，所以還原成原樣。真正的修法是逐欄驗證 audit 紀錄，留作後續。
- `onboarding-state.ts`、`ipc/pets.ts`、`agent-adapter-operations.ts:38`、`history.ts:1389`：都是 `JSON.parse(...) as Record` 或 SQLite row 的斷言。這些要的是「補驗證」而不是「換守衛」，不在本階段範圍。

### Code review 結論

- **安全邊界**：IPC payload 仍在 main 做執行期驗證。每一處替換若不是完全等價，就是只讓陣列改成被拒絕（見上節），沒有任何一處放寬驗證。`preload.ts` 那兩處只是 renderer 端的形狀檢查，main 端的驗證沒有變動。`quota.ts` 讀取與寫回的憑證欄位都沒變，而且有測試固定。`plugin-secret-consent.ts` 拿掉的 `'accepted' in value`，在 `isRecord` 之後和 `value.accepted === true` 等價。
- **子代理產出複驗**：Sonnet 改的 23 個檔案逐一看過，修正了兩個問題。一是 `presentation-controller.ts` 有兩行重複的 value-guards import，已合併；二是 `permission-audit.ts` 的型別錯誤，已還原（見上節）。子代理自己重產的 IPC 清單，已改用修正後的產生器再產生一次。`ipc/permission.ts`、`ipc/project-pets.ts`、`ipc/plugin-panel-ui.ts`、`permission-adapter-server.ts` 留著 `const data = payload` 這類別名，用意是不動後面一長串欄位讀取；對可讀性影響小，所以不再擴大 diff。
- **規範**：electron 端的 import 一律帶 `.ts`，因為測試用 `--experimental-strip-types` 直接執行這些檔案；`preload.ts` 沿用該檔不帶副檔名的寫法。`value-guards.ts` 沒有任何 import，不會把相依帶進 `src/` 的測試閉包（本階段沒動 `src/**`）。新增的註解都用繁體中文，只寫原因。`plugin-host-assets.ts`、`plugin-panel-themes.ts`、`integrations/**`、`.claude/` 都沒動。
- 沒有 Liquid Glass 或其他視覺變更，不需要跑視覺閘門。

### 驗證

| 檢查 | A 之後 | B 之後 |
|---|---|---|
| `pnpm lint` | 0 error、49 warning（`no-explicit-any`） | 0 error、39 warning（全是 `no-explicit-any`，沒有其他種類）；main-process lint passed |
| `pnpm exec vue-tsc --noEmit` | 0 error | 0 error |
| `pnpm test:unit` | 1812 項：1773 pass、0 fail、39 skip | 1823 項：1784 pass、0 fail、39 skip（新增 11 項：quota-parsing 8、value-guards 3；另有 4 個既有測試檔補了斷言） |
| `git diff --check` | 通過 | 通過 |

- `tests/quota-parsing.test.mts` 先在未修改的 `quota.ts` 上跑過，8/8 通過；改完後再跑，仍是 8/8。
- 第一次全量測試時 `ipc-inventory` 失敗，原因是安全清單文件和原始碼不同步。修正產生器並重新產生後，0 fail。

### 殘留風險

- Claude CLI 路徑（`readClaudeCliUsage`）沒有端到端測試，因為測試刻意清空 PATH，避免執行本機的 `claude`。這段只改了型別（`result?.result`、`result?.is_error`），正確性是靠型別檢查和閱讀程式碼判斷的。
- macOS Keychain 的憑證路徑沒有覆蓋：Claude 憑證檔的測試在 macOS 上會 skip，本機只在 Windows 上跑過。
- 陣列 payload 現在會被拒絕。如果有 renderer 呼叫端真的送陣列、又依賴陣列上的具名欄位，就會失效。已 grep 確認 preload 送出的都是物件字面值，但沒有啟動 app 實機驗證。
- `permission-audit.ts` 仍然是「確認是物件後直接斷言成 `PermissionAuditRecord`」，沒有逐欄驗證。這是既有問題，留給後續處理。
