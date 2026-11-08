# 階段報告：寵物狀態列回到單行、狀態詞改用英文、溢出選單圖示

> 分支 `fix/pet-line-kebab`，基於 `main` @ d97b3a5（1.11.4）。版號尚未變更。

## 問題

1. **狀態列變厚**：1.11.4 在同一家族有多個工作階段時，於狀態列加了第二行專案名稱（例如 `Claude · 工作中 71%` 下方再一行 `agent-pets`），狀態列從約 24 px 變成約 37 px，比原本的細條粗重許多。
2. **狀態詞**：使用者希望狀態列上的狀態詞不論介面語言都以英文顯示。
3. **溢出選單圖示**：`more` 圖示是三個零長度線段，在 18 px 下是三個又小又細的點，不像 Material 的 `more_vert`。

## 變更

| 區塊 | 檔案 | 內容 |
|---|---|---|
| 狀態列 | `DesktopPet.vue/.css`、`src/utils/session-attention.ts` | 移除第二行專案列（單寵物與多寵物）。狀態列回到 1.11.3 的單行結構與尺寸（`line-height: 1.3`、`padding: 3px 9px`）：狀態點、名稱 · 狀態、Quota 百分比與分段條。保留 1.11.4 的其他改善：沒有 `(+N)`、名稱先縮、`role="group"` 與完整的 aria-label、完成標記設定。`statusLineText()` 只回傳完整文字（名稱、CLI/Desktop、專案、在地化狀態），專案只出現在提示框與 aria-label；移除不再使用的 `truncateProject()`。 |
| 狀態不被截斷 | `DesktopPet.css` | 狀態改為 `flex: none`。原本的 `flex-shrink: 1` 即使只縮 0.01 px，`text-overflow` 也會把字尾換成省略號（多寵物 180 px 欄位出現 `Permissi…`）。沒有插件徽章時，徽章容器不再佔一個 gap。 |
| 提示框 | `DesktopPet.css` | 額度提示框第一行（完整名稱、專案與狀態）允許換行，最多三行；長專案名不再被截成 `agent-pets-…`。 |
| 視窗高度 | `src/utils/pet-window-height.ts`、`src/stores/agentStore.ts` | 移除專案列的高度預算（`STATUS_LINE_PROJECT_H`、`showsProjectRow()`）；`petWindowHeight()` 只依行數計算，與 1.11.3 相同。 |
| 英文狀態詞 | `src/utils/state-aria.ts`、`src/locales/pet/*.json` | `stateLineLabel()` 改用固定的英文短字對照（Idle、Thinking、Working、Permission、Needs input、Done、Failed、Offline），不經過 `t()`；移除兩個語系檔中不再使用的 `pet.lineState*`。提示框與 aria-label 仍使用介面語言的完整說法。面板使用的 `STATE_LABELS_SHORT` 不變。 |
| 溢出圖示 | `src/components/ui/icons.ts`、`src/components/ui/Icon.vue` | `more` 改為三個實心圓點（16 格座標中心 y = 4／8／12、半徑 1.333，與 `more_vert` 在 24 格的比例相同），以圓弧自行繪製。新增 `FILLED_ICONS`，`Icon` 對其中的圖示改用 `fill="currentColor"`、`stroke="none"`；其他圖示維持線條樣式。 |
| 文件 | `README.md`、`README.zh-TW.md` | 狀態列說明改為單行、英文狀態詞與範例 `Claude · Working 71%`。 |

## 驗證

| 檢查 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 通過 |
| `pnpm run lint` | 通過 |
| `pnpm run test:unit` | 1028／1028 通過 |
| `pnpm exec vite build` | 通過 |
| `pnpm run check:bundle-size`／`check:bundle` | 通過 |
| `pnpm run check:contrast` | 通過 |
| `pnpm run check:design:strict` | 通過，與 main 相同（沒有新增 finding） |
| `git diff --check` | 通過 |

更新的測試：`pet-window-height`（只依行數）、`session-attention`（完整文字含專案、模板沒有第二行、英文狀態詞與語系檔中不再有 `pet.lineState*`）、`icons`（`more` 為三個中心 4／8／12 的實心圓點，只有它是填色圖示，`Icon` 的填色分支）。

**隔離 Electron 實測**（`scripts/e2e-isolated-electron.mjs`：暫存 HOME／userData、假 safeStorage、`security`／`claude`／`codex` 指向 `/usr/bin/false`；1.11.3 與 1.11.4 以 `--app-root` 執行各自的建置）。寵物狀態與 Quota 直接注入寵物視窗的 store，zh-TW 介面：

| 情境 | 1.11.3 | 1.11.4 | 本分支 |
|---|---|---|---|
| 單寵物、Claude 3 個工作階段、長專案名、有 Quota：狀態列高度 | 23.59 px | 36.79 px | 23.59 px |
| 同上：寵物視窗高度 | 422 px | 436 px | 422 px |
| 單寵物三個家族堆疊：視窗高度 | 466 px | 494 px | 466 px |
| 多寵物（Codex＋Claude）：每條狀態列高度 | — | 36.79 px | 23.59 px |

- 狀態列只顯示 `Claude · Working 71%` 與分段條；滑過時的提示框顯示 `Claude (CLI+Desktop) · <完整專案名> · 工作中` 與額度明細，aria-label 為同樣的中文完整文字。
- 多寵物 180 px 欄位：`Codex · Permission 40%` 與 `Claude · Working 71%` 都完整，沒有省略號。三個家族堆疊時，`OpenCode · Needs input` 也完整。
- 視窗高度預算等於實際視窗高度，最後一條狀態列底部正好落在視窗內（與 1.11.3 相同）。
- 溢出圖示：面板標題列 18 px 圖示置中於 38 px 按鈕；勿擾的 8 px 圓點位於右上角，與最上方的圓點不重疊。插件卡片的選單按鈕同樣置中。淺色與深色主題都已截圖確認。

## 未驗證項目與殘留風險

- 狀態列畫面上的狀態詞是英文，可存取名稱是中文；語音控制使用者說出畫面上的「Working」可能對不上（WCAG 2.5.3 Label in Name）。這是使用者明確要求的取捨。
- 隔離測試在開發機上取得了 hook 埠，真實工作階段可能同時寫入測試 store；截圖前重新注入狀態，截圖只裁切寵物與面板標題、插件卡片。
- `PluginDetail` 的選單按鈕沿用同一個 `Icon` 與 `ActionMenu`，未單獨截圖。
- Windows 分層視窗、高對比、減少透明度與 125%／150% 縮放未在本階段實測。

## 建議版號

修補版（patch，1.11.5）：版面與圖示修正，加上狀態詞顯示方式的調整；沒有變更偏好欄位、IPC 或資料格式。
