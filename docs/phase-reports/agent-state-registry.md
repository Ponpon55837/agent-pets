# Agent 狀態 registry

## 範圍

每個 `AgentState` 的對應資料原本散在約 10 處（4 個常數表、2 個 util 表、5 個 switch、1 份重複的完整狀態清單）。現在收成兩張用 `as const satisfies Record<AgentState, …>` 檢查的表，新增狀態時任何一格沒填都會讓型別檢查失敗。

| 表 | 位置 | 欄位 | 使用者 |
|---|---|---|---|
| `AGENT_STATE_POLICY` | `src/types/agent.ts` | `priority`、`notification`（`null` 或 `{ terminal }`）、`historyOutcome` | 主程序（通知、歷史）與 renderer（優先序） |
| `AGENT_STATE_PRESENTATION` | `src/utils/agent-state-presentation.ts` | `label`、`shortLabel`、`color`、`ariaKey`、`lineWord`、`mini`、`cue` | 只有 renderer |

- `STATE_PRIORITY` 改由 policy 表推導，對外保留同名匯出。
- 移除 `STATE_LABELS`、`STATE_LABELS_SHORT`、`STATE_COLORS`、`STATE_LINE_WORDS`、`STATE_ARIA_KEYS`。呼叫端改讀 presentation 表。
- 以下的 switch 改成查表：`DesktopPet.vue` 迷你徽章、`notification-policy.ts`、`history-sessions.ts` 的 `nextFinalState`，以及以 `SoundCue` 為鍵的 `sound.ts`（音形）和 `sound-policy.ts`（開關）。
- 主程序只補自己的通知標題表 `NOTIFICATION_TITLE_KEYS`，型別是 `Record<NotifiableAgentState, TranslationKey>`，其中 `NotifiableAgentState` 由 policy 表推導。
- 帶條件的邏輯留在原處：external-only 權限標題，以及 store 依狀態轉換判斷要不要播音（例如成功太快不播）。
- `electron/history.ts` 的重複完整狀態清單和 store 的快照還原檢查，改用 `isAgentState`（`Object.hasOwn`）。
- 刪除沒有任何呼叫端的 `src/utils/state-label.ts`。`design.state.*` 語系 key 仍由 `tests/i18n-html-lang.test.mts` 檢查，所以保留。
- 不在範圍內：`pet-motion-plan.ts`、`PetAnimation.vue`、`pet-sprite-validation.ts`、`pet-atlas-preview.ts`（sprite 線負責）。

## 證據

- 先寫特性測試並 commit（`2617c68`）：在舊程式碼上鎖住每個狀態的優先序、標籤、顏色、狀態列用字、通知候選、歷史結局和音效開關，5/5 通過。重構後同一組數值依然成立。新增的測試會檢查兩張表剛好涵蓋 8 個狀態，不認得的字串（`constructor`、`toString`、`__proto__`）不會被當成狀態。
- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run check:design`、`check:design:strict`：全部通過。design 報告和 base commit 完全相同（`unused:1, rawControls:15, rawColors:0`）。
- `pnpm run test:unit`：1216 pass / 0 fail / 1 skipped。
- 用 `node scripts/e2e-isolated-electron.mjs --hook-port-base 28473` 實測，`fakeSafeStorage: true`，沒有存取鑰匙圈。每個狀態都以帶 token 的 HTTP 事件送進去，再用 CDP 讀寵物視窗：
  - 狀態列用字和點的顏色，8 個狀態都正確，例如 `Working`／`var(--state-active)`、`Needs input`／`var(--state-warn)`。
  - 家族 aria-label 和寵物 aria-label 是已翻譯的說法。
  - 迷你模式透過真實 IPC `setPetWindowMode('mini')` 進入：標籤、外環色、圖示或圓點和原本的 switch 一致。
  - 通知紀錄：等待權限與等待輸入為 `shown`；成功加失敗彙整成一則 `count: 2`；其他狀態不通知。

## 安全與效能

- 沒有新增 IPC、檔案 I/O 或網路，主程序也沒有匯入 renderer 模組。
- 修掉一個小漏洞：store 原本用 `in STATE_PRIORITY` 檢查快照，`'constructor'` 會被當成合法狀態還原，現在改用 `hasOwn`。
- 熱路徑：通知分類和歷史分類從 switch 改成一次 `hasOwn` 加查表，`STATE_PRIORITY` 在模組載入時建一次，成本可忽略。

## 殘留風險

- 實測只在 macOS；Windows 未測。
- `src` 和 `electron` 裡還有 8 處只用部分狀態的分類 Set，各自語意不同，維持原樣：
  - `session-attention`、`session-view` 的 attention／running
  - `HistorySessionDetail`、`history.ts` 的 terminal／active
  - `event-server` 的 rate-limit 優先
  - `StatusPanelSessions` 的 live
  - `progression` 的 active
  - `pet-motion-plan` 的 waiting（sprite 線負責）
- `event-normalizer` 的 `VALID_STATES` 含有外部別名 `waiting`，屬於 hook 契約，沒有動。

## 版本建議

Patch：內部重構，沒有改外部契約、持久化結構或安全邊界。等使用者確認後再改版本號。
