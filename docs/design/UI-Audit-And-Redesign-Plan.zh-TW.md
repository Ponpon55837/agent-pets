# Agent Pets UI 稽核與重新設計計畫

- 版本：v0.8.1（`main`，含 Phase 7 未提交變更）
- 稽核日期：2026-08-13
- 稽核範圍：`src/App.vue`、`src/components/*.vue`、`src/stores/agentStore.ts` 視圖狀態、`electron/main.ts` 視窗尺寸策略
- **目標平台：Windows（portable）與 macOS（dmg）雙平台**（`package.json` build targets）。所有設計決策須同時成立於兩個平台，不得偏向其一。
- 目的：在 Codex 持續加功能的前提下，先定義「UI 為什麼撐不住」，再給出可分階段落地的重設計方案

---

## 0. 一句話結論

功能面已經走到 Phase 7，但 UI 仍停留在 Phase 0～1 的「一個 380px 小面板」假設上。**問題不是不好看，是承載結構已經超載**：固定尺寸視窗、無設計 token、單檔 2,561 行的 StatusPanel、9–10px 主力字級。再往上疊功能，每一個新頁面都會讓現有問題乘以一次。

使用者回報的兩個體感——「不同頁面風格不統一」與「點擊手順不順」——在程式碼裡都有明確對應物，分別見 §2.5 與 §2.6，並非主觀感受：

- **不統一的來源**：同一個面板裡有 5 套卡片、12 種按鈕、9 種進度條軌道、2 種導覽形態、3 種表面材質，且 6 個設定分頁中有 2 個缺少其他 4 個都有的 hero 區塊。
- **手順不順的來源**：設定有 3 條入口路徑、6 個開關在托盤與設定頁重複出現形成兩個真相來源、面板失焦即關閉且**重開會強制跳回 Sessions 視圖**、寵物右鍵被 `preventDefault` 吃掉而沒有捷徑。

---

## 1. 現況量化

| 指標 | 數值 | 來源 |
| --- | --- | --- |
| StatusPanel 單檔行數 | 2,561 | `src/components/StatusPanel.vue` |
| 元件層 Vue 總行數 | 7,637 | `src/**/*.vue` + store |
| 不重複 hex 色 | 121 | `src/**/*.vue` |
| 不重複 rgba() 值 | 145 | 同上 |
| CSS 自訂屬性（設計 token）定義數 | **0** | 僅 `--pet-scale` / `--pet-w` 由 JS 注入 |
| 不重複 font-size 值 | 17 種 | 最多為 `10px`(37 次)、`9px`(26 次) |
| `prefers-color-scheme` 使用 | 0 | — |
| `:focus-visible` 規則 | 10 條（跨 5 個元件） | 大量互動元素未覆蓋 |
| 原生 `window.confirm` | 3 處 | StatusPanel ×2、ProjectMcpPanel ×1 |

---

## 2. 問題清單

依「會不會擋住後續開發」排序。

### P0-1 視窗尺寸是硬編碼常數，不隨內容變化

`src/stores/agentStore.ts:1105-1128` 對每個視圖硬寫死尺寸：

| 動作 | 呼叫 | 結果尺寸 |
| --- | --- | --- |
| `backToSessions()` | `resizePanel(380)` | 380×380 |
| `openSettings()` | `resizePanel(420)` | 380×420 |
| `openProjectMcpPanel()` | `resizePanel(720, 680)` | 680×720 |
| `closeProjectMcpPanel()` | `resizePanel(420, 380)` | 380×420 |

衍生的具體壞味道：

- **Dashboard 三個分頁（Sessions / Usage / History）共用同一個 380×380 視窗。** History 視圖（`StatusPanel.vue:482-584`）內有 6 張以上卡片、7 天長條圖、Agent 分佈、Quota 快照——全部塞進 380px 高度內捲動，實際一次只看得到約 1.5 張卡片。這是 Phase 7 新功能直接撞牆的地方。
- **Sessions 列表 `max-height: 320px`**（`:1488`）寫死。視窗 380px 高、扣掉 header 與 tabs 後根本到不了 320px，兩個限制互相打架。
- **Project MCP 面板 680×720，是其他視圖的 3 倍面積。** 進出時視窗尺寸暴跳，桌面上會看到一次明顯的形變動畫（`animateBounds`，`electron/main.ts:247`）。
- **SetupWizard 期望 `width: min(520px, 100% - 28px)`**（`SetupWizard.vue:271`），但它是 render 在 380px 寬的面板裡，永遠只拿得到 352px，且開啟時**完全沒有 resize**。設計意圖與實際渲染不一致。

### P0-2 沒有設計系統，樣式全靠 121 個 hex + 145 個 rgba 手抄

零個 CSS 變數。同一語意的顏色在不同檔案各寫一次：

- 主色 `#8b9cf7` 出現 12 次，其對應的透明版本 `rgba(139, 156, 247, ...)` 另有 0.045 / 0.07 / 0.08 / 0.13 / 0.15 / 0.18 / 0.22 / 0.23 / 0.25 / 0.4 至少 10 個不同 alpha，全部手寫。
- 表面色三種互不相同：StatusPanel `rgba(18,18,26,0.86)`（`:988`）、SetupWizard `rgba(25,25,35,0.98)`（`SetupWizard.vue:274`）、ProjectMcpPanel `rgba(25,25,35,0.98)`（`ProjectMcpPanel.vue:252`）。前者有 `backdrop-filter: blur(24px)`，後兩者沒有——同一個視窗裡三種材質。
- 圓角有 6px / 7px / 8px / 10px / 12px / 16px / 999px 七種，沒有規則。

**後果**：任何全域視覺調整（例如「主色改一下」「提高對比度」）都是跨檔案的 100+ 處手動搜尋取代，且無法驗證是否漏改。這是目前最直接的維護成本。

### P0-3 主力字級 9–10px，低於兩平台的可讀下限

字級分佈：`10px`×37、`9px`×26、`11px`×16、`8.5px`×3、`8px`×2。

也就是說 **超過一半的文字小於 11px**。受影響的都不是裝飾文字，而是實際資訊：

- `.quota-label` / `.quota-value` 10px、`.quota-reset` 9px（`:1174-1213`）——Quota 是核心資訊
- `.history-hero p` 9px、`.usage-footer` 9px、`.history-action` 按鈕 9px
- `.settings-nav-heading` 9px

9px 的中文在 Windows 100% DPI 下幾乎無法辨識筆畫；macOS 雖有較佳的字型平滑，9px CJK 同樣低於舒適閱讀門檻，且兩平台的預設 UI 字型（Segoe UI / SF Pro）在小字級的實際光學大小不同，**同一個 9px 標籤在兩邊的視覺份量並不一致**。加上全域 `text-shadow: 0 1px 2px rgba(0,0,0,0.55)`（`:994`）進一步糊化字緣，小字級受害最深。

這是「面板太窄 → 只好縮字」的代償，根因仍是 P0-1。

### P1-1 StatusPanel 是 2,561 行的單一元件

一個檔案同時負責：面板外框與 header、三個 dashboard 分頁、六個設定分頁、寵物清單管理、歷史統計圖表、Quota 圖表、匯入流程、重新命名互動。

- template 約 650 行、`<style scoped>` 約 1,580 行
- `settingsTab` 有 6 個值、`dashboardTab` 有 3 個值，兩組 `v-if/v-else-if` 鏈交錯

任何一個新設定項都要進這個檔案。Codex 每加一個功能就讓它更長，且不同功能改到同一個檔的機率接近 100%（merge 衝突熱點）。

### P1-2 語言不一致：狀態標籤永遠是英文

`src/types/agent.ts:65-72` 的 `STATE_LABELS` 與 `:78` 的 `STATE_LABELS_SHORT` 是**硬編碼英文常數**，完全不經過 i18n：

```ts
export const STATE_LABELS: Record<AgentState, string> = {
  offline: 'Offline',
  thinking: 'Thinking',
  'waiting-permission': 'Waiting Permission',
  ...
}
```

i18n 已有 464 個 key、支援 zh-TW / en-US（`src/i18n.ts`），但**使用者最常看的那顆狀態 chip 和寵物身上的狀態行永遠顯示英文**。繁中介面裡出現「Waiting Permission」與旁邊的「等待權限」說明並存。

同一類問題還有 `SOURCE_LABELS`（`:100`）。

### P1-3 硬編碼中文字串繞過 i18n

`src/components/StatusPanel.vue:329-330`：

```ts
const message = pet.builtIn
  ? `要從寵物清單隱藏「${pet.displayName}」嗎？此操作無法從介面復原，但不會刪除內建素材。`
  : `要移除「${pet.displayName}」嗎？這會刪除匯入的素材檔案，且無法復原。`
```

切到 English 後這兩段仍是中文。與 P1-2 是同一個病灶的兩面：i18n 覆蓋率沒有機制保證。

### P1-4 三處原生 `window.confirm`

`StatusPanel.vue:165`（清除歷史）、`StatusPanel.vue:331`（移除寵物）、`ProjectMcpPanel.vue:87`。

原生對話框在無框透明的桌面寵物情境下特別突兀：它會帶出系統樣式的方框、標題顯示 Electron 檔名、且**會搶走面板焦點導致面板可能被判定失焦而收起**。破壞性操作（刪素材、清歷史）恰好是最需要良好確認 UI 的地方。

且兩平台的表現不同——Windows 是視窗中央的獨立方框，macOS 是附著於視窗頂端的 sheet 動畫。同一段確認流程在兩邊是兩種體驗，無法透過 CSS 統一。

### P2-1 資訊架構：兩層導覽 + 九個分頁，塞在 380px 內

- 第一層：`panelView` = sessions | settings（靠 header 返回鍵切換）
- 第二層 A：dashboardTab = Sessions / Usage / History（pill tabs）
- 第二層 B：settingsTab = 語言 / 外觀 / 桌面 / 寵物 / 成長 / 進階（116px 側欄）

設定頁在 380px 寬裡切出 116px 側欄（`:1601-1603`），內容區只剩 **約 248px 可用寬度**——所有 `toggle-row` 都要在 248px 內擺下「標題 + 說明文字 + 開關」，這正是說明文字被壓到 9px 的原因。

另外「桌面」分頁下的 `attention` 群組塞了 5 個開關（勿擾、通知、權限泡泡、Presentation MCP、音效），語意上音效與 Presentation MCP 並不屬於「注意力」。

### P2-2 無障礙覆蓋不完整

- `:focus-visible` 僅 10 條規則，`SetupWizard.vue` 與 `PetAnimation.vue` 為 0。鍵盤操作在精靈裡看不到焦點。
- `.pet-option`（`:863-869`）是 `<div>` 加 `@click`，非 `<button>`，無 `tabindex`、無鍵盤可達性——選擇寵物這個主要動作鍵盤打不到。
- `aria-` 使用尚可（StatusPanel 28 處、DesktopPet 22 處），但 `dashboard-tabs` 有 `role="tablist"` / `role="tab"`，卻沒有對應的 `tabpanel` 與 `aria-controls`。
- `prefers-reduced-motion` 僅 4 處，而 `transition:` / `animation:` 宣告共 54 處。

### P0-4 視覺不統一：同一個面板裡有多套並存的視覺語彙（§2.5）

這是使用者「不論打開哪個頁面都覺得不統一」的直接成因。逐項清點：

**(a) 五套互不相干的卡片**

`.settings-card`、`.settings-hero-card`、`.history-card`、`.usage-provider`、`.progression-card`（另加 `ProjectMcpPanel.vue` 的 `.project-mcp-card`）。每套自己定義 padding、圓角、邊框、背景漸層。例如 `.usage-provider` 用 `linear-gradient(160deg, ...)` + `border-radius: 10px`（`:1124-1131`），`.history-card` 用另一組值。使用者切換 Usage → History 時看到的是兩種不同材質的方塊。

**(b) 十二種按鈕，沒有 variant 系統**

`.header-btn`、`.dashboard-tab`、`.settings-nav-item`、`.scale-option`、`.usage-refresh`、`.history-action`、`.import-btn`、`.setup-btn`、`.restart-btn`、`.quit-btn`、`.mood-reset-btn`、`.clear-offline-btn`、`.pet-edit`、`.pet-remove`。

沒有任何兩個共用樣式宣告。字級從 9px 到 13px、圓角從 6px 到 999px、hover 效果各寫一套。**同樣是「主要動作」的 `.setup-btn` 與 `.usage-refresh` 長得完全不同**，使用者無法從外觀推斷可點性與重要性。

**(c) 九種進度條軌道**

`.quota-track`、`.mood-bar`、`.progression-bar`、`.history-progress-track`、`.history-day-track`、`.history-agent-track`、`.switch-track`，以及對應的 fill。全都是「圓角軌道 + 百分比填色」，卻有各自的高度（6px / 8px / …）與漸層。

**(d) 同一層級的導覽用了兩種形態**

- Dashboard 第二層：水平 pill tabs（`.dashboard-tabs`，`:1071-1102`）
- Settings 第二層：垂直側欄清單（`.settings-nav`，`:1601-1650`）

兩者在資訊架構上是同一層，視覺上卻毫無關聯。使用者從 Sessions 進到 Settings，導覽模式突然改變，這是「頁面之間不像同一個 app」的最大單一因素。

**(e) 六個設定分頁，只有四個有 hero 區塊**

| 分頁 | hero card |
| --- | --- |
| 語言 | ✅ `:614` |
| 外觀 | ✅ `:642` |
| 桌面 | ✅ `:693` |
| 成長 | ❌ 直接進內容 |
| 寵物 | ❌ 直接進內容 |
| 進階 | ✅ `:949` |

在同一組側欄裡切換分頁，版面結構會時有時無地跳動。

**(f) 圖示語彙混雜**

設定側欄圖示（`:15-22`）：`文`（漢字）、`◈`（幾何符號）、`⌘`（Mac Command 鍵符號）、`✦`、`↗`、`⋯`。四種不同來源的字符混用。寵物側則另用 `!`、`✦`（`DesktopPet.vue:306`、`:370`）。

除了語彙不一致，這組字符還有**跨平台渲染風險**——本產品同時發佈 Windows（portable）與 macOS（dmg）版本（`package.json` build targets）。純文字字符的字形完全交給系統字型決定：

- `⌘` 在 macOS 上是 Command 鍵，語意指向鍵盤快捷鍵而非「桌面行為」，用在這裡本身就偏離語意；在 Windows 上則既無語意也可能落到 fallback 字型。
- `◈`、`✦`、`↗` 屬於較冷僻的 Unicode 區段，兩平台的預設字型覆蓋度不同，實際字重與大小會有落差。
- `文` 是 CJK 字元，會被套用與旁邊拉丁字符不同的字型度量，垂直對齊天生對不齊。

也就是說，同一份設定側欄在 Windows 與 macOS 上長得不一樣，且**沒有任何 CSS 能修正**。

**(g) 殘留的死樣式**

`.settings-tabs` / `.settings-tab` 的 CSS 仍在，但 template 已改用 `.settings-nav`，無任何引用。這類殘留會讓後續開發者誤判現有慣例。

### P0-5 操作手順：入口重複、狀態被重置、捷徑缺席（§2.6）

**(a) 設定有三條入口，且托盤與設定頁互為重複的真相來源**

進入設定的路徑：

1. 點寵物 → 面板開啟 → 右上齒輪 → 設定
2. 托盤右鍵 → 開啟設定
3. 托盤右鍵 → 開啟控制面板 → 右上齒輪 → 設定

更嚴重的是 `electron/desktop-tray.ts:74-133` 的托盤選單**直接內嵌了 6 個開關**：勿擾、音效、通知、權限泡泡、Presentation MCP、開機時啟動。這 6 項與設定頁「桌面」分頁（`StatusPanel.vue:727-792`）**完全重複**。

同一個偏好設定有兩個位置可改，使用者要記住哪個功能在哪裡；而托盤選單還多了「迷你模式」「邊緣停靠」（`:80-89`），設定頁則多了「寵物大小」等托盤沒有的項目——**兩邊都不是完整集合**。這是手順混亂的主因。

**(b) 面板失焦即關閉，且重開強制跳回 Sessions**

`electron/main.ts:808` 的 blur 事件會隱藏面板。而 `agentStore.ts:1132-1136` 的 `handlePanelOpened()`：

```ts
function handlePanelOpened() {
  panelView.value = 'sessions'   // ← 強制重置
  showWizard.value = false
  showProjectMcpPanel.value = false
}
```

實際情境：使用者在「設定 → 寵物」分頁匯入素材，系統檔案對話框或任何其他視窗取得焦點 → 面板消失 → 再點寵物打開 → **回到 Sessions 視圖，要重新點三次才回到剛才的位置**。搭配 §P1-4 的原生 `window.confirm` 會搶焦點，破壞性操作的確認流程有機率直接把面板關掉。

**(c) 寵物只有單一手勢，右鍵被浪費**

`DesktopPet.vue:231-240` 的 `onClick` 只做一件事：`store.togglePanel()`。而 `:271` 的 `@contextmenu.prevent` 把右鍵**完全吃掉且不做任何事**。

桌面寵物最自然的捷徑（右鍵開選單）目前是死的，所有操作都被迫走「左鍵 → 面板 → 分頁 → 項目」的長路徑。

**(d) 深層功能埋太深**

| 功能 | 步數 | 路徑 |
| --- | --- | --- |
| Project MCP 設定 | 5 | 寵物 → 齒輪 → 進階 → 按鈕 → 680×720 彈窗 |
| 設定精靈 | 4 | 寵物 → 齒輪 → 進階 → 按鈕 |
| 清除歷史 | 4 | 寵物 → History 分頁 → 清除 → 原生 confirm |

設定精靈是新使用者最需要的東西，卻放在「進階」分頁最底部，與「重新啟動」「結束」等破壞性操作並列（`:963-969`）。

**(e) 缺少鍵盤路徑**

設定頁返回只能點左上角的 `‹`（`:329-335`），**沒有 Esc 綁定**。面板本身也沒有全域快捷鍵可喚出——唯一入口是滑鼠點寵物或托盤。

### P2-3 深色單一主題，無淺色支援

`prefers-color-scheme` 使用次數為 0。整個面板寫死深色玻璃。在淺色桌布上 `rgba(18,18,26,0.86)` 尚可讀，但寵物本體的泡泡與狀態行（`DesktopPet.vue`）在白色背景下對比不足。

---

## 3. 重新設計方案

### 3.1 設計原則

1. **面板尺寸由內容決定，不由視圖名稱決定。** 移除 `resizePanel(固定值)`，改為量測 + 上下限夾制。
2. **一個 token 層，三種表面。** 所有顏色/間距/圓角/字級只能引用變數。
3. **元件依「使用者任務」拆檔，不依「技術層次」。** 一個設定分頁 = 一個檔。
4. **最小字級 11px，說明文字 12px 起。** 靠加大面板換回可讀性。

### 3.2 設計 token（第一步，收益最高）

新增 `src/styles/tokens.css`，於 `index.html` 或 `App.vue` 全域引入：

```css
:root {
  /* 表面 —— 三種材質，全 app 只有這三種 */
  --surface-panel:   rgba(18, 18, 26, 0.86);
  --surface-raised:  rgba(255, 255, 255, 0.05);
  --surface-overlay: rgba(12, 12, 18, 0.94);
  --surface-blur:    blur(24px) saturate(165%);

  /* 邊框 */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);

  /* 品牌 / 語意色 */
  --accent:        #8b9cf7;
  --accent-soft:   rgba(139, 156, 247, 0.15);
  --accent-line:   rgba(139, 156, 247, 0.40);
  --state-success: #50c878;
  --state-error:   #ff6b6b;
  --state-warn:    #ffe37c;
  --state-info:    #9dd8ff;

  /* 文字階層 —— 只有四級 */
  --text-primary:   #e8ecfa;
  --text-secondary: #a4a8b4;
  --text-muted:     #858b9b;
  --text-on-accent: #f1f3ff;

  /* 字級 —— 只有五級，下限 11px */
  --font-xs: 11px;   /* 註解、時間戳 */
  --font-sm: 12px;   /* 說明文字 */
  --font-md: 13px;   /* 內文（預設） */
  --font-lg: 15px;   /* 卡片標題 */
  --font-xl: 18px;   /* 數據大字 */

  /* 間距 —— 4px 基準 */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 24px;

  /* 圓角 —— 只有四級 */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-pill: 999px;
}
```

搭配一條**驗證規則**：CI 或 lint 檢查 `src/**/*.vue` 的 `<style>` 區塊不得出現裸 hex（`STATE_COLORS` 這類 JS 常數例外，另立 token 對映）。沒有這條規則，token 三週後就會被繞過。

### 3.3 面板尺寸：改為內容驅動

移除 `agentStore.ts:1105-1128` 的四處硬編碼，改為單一機制：

```ts
// StatusPanel.vue
const rootEl = ref<HTMLElement>()
useResizeObserver(rootEl, ([entry]) => {
  const h = clamp(entry.contentRect.height, 320, 720)
  const w = viewNeedsWide.value ? 560 : 400
  window.electronAPI?.resizePanel(h, w)
})
```

`DesktopPet.vue:158-168` 已經有 `ResizeObserver` 的成功先例，直接沿用同一模式。

同時調整基準尺寸：

| 視圖 | 現況 | 建議 |
| --- | --- | --- |
| Sessions | 380×380 | 400×自適應（上限 560） |
| Usage | 380×380 | 400×自適應 |
| History | 380×380 | **560×自適應（上限 720）**，卡片改兩欄 |
| Settings | 380×420 | **560×560**，側欄 140px，內容區得到 400px |
| Project MCP | 680×720 | 沿用 680×720（已經是對的，其他向它靠攏） |

寬度變化用既有的 `animateBounds` 過渡即可，但**同一視圖內的分頁切換不應改變寬度**，只允許高度變化，避免視覺跳動。

### 3.4 元件拆分

```
src/components/
  panel/
    PanelShell.vue          # 外框 + header + 返回/設定/關閉
    PanelTabs.vue           # 共用 pill tabs（含 tabpanel a11y）
  dashboard/
    SessionsView.vue
    UsageView.vue
    HistoryView.vue
  settings/
    SettingsLayout.vue      # 側欄 + 內容容器
    sections/
      LanguageSection.vue
      AppearanceSection.vue
      DesktopSection.vue
      PetsSection.vue
      GrowthSection.vue
      AdvancedSection.vue
  ui/                       # 原子元件，吃 token
    Button.vue              # 取代 12 種按鈕樣式（4 個 variant，見 3.5b）
    Card.vue                # 取代 5 套卡片樣式（3 個 variant，見 3.5a）
    ToggleRow.vue           # 取代 22 處重複的 toggle-row 樣板
    ProgressTrack.vue       # 統一 quota-track / mood-bar / progression-bar / history-*-track
    ConfirmDialog.vue       # 取代 3 處 window.confirm
    ContextMenu.vue         # 寵物右鍵選單（見 3.6d）
    icons/                  # 6 個 inline SVG，取代混雜字符（見 3.5f）
```

**`ToggleRow.vue` 的收益最直觀**：目前設定頁有 22 個結構完全相同的 `<label class="toggle-row">` 樣板（含 `<span class="switch">` 三層巢狀），每個都是 10 行重複 template。抽成元件後每個開關 1 行。

**`ProgressTrack.vue`** 收斂目前四套獨立實作的進度條：`.quota-track`、`.mood-bar`、`.progression-bar`、`.history-day-track` / `.history-agent-track` / `.history-progress-track`。

### 3.5 視覺統一：把多套語彙收斂成一套（對應 P0-4）

token（3.2）解決「同一個顏色寫很多次」，這節解決「同一個東西長很多樣」。原則是**每種視覺元素只允許存在一個實作，差異透過 variant prop 表達**。

**(a) 卡片 → 一個 `ui/Card.vue`**

```
<Card>                    預設：內容卡（取代 .settings-card / .history-card / .usage-provider）
<Card variant="hero">     區段開場（取代 .settings-hero-card）
<Card variant="accent">   強調（取代 .progression-card）
```

統一規格：`padding: var(--space-3)`、`border-radius: var(--radius-md)`、`border: 1px solid var(--border-subtle)`、`background: var(--surface-raised)`。漸層只保留 hero 一種。

**(b) 按鈕 → 一個 `ui/Button.vue`，四個 variant**

| variant | 用途 | 取代 |
| --- | --- | --- |
| `primary` | 區段主要動作 | `.setup-btn`、`.import-btn` |
| `secondary` | 次要動作 | `.usage-refresh`、`.history-action`、`.clear-offline-btn`、`.mood-reset-btn`、`.restart-btn` |
| `danger` | 破壞性 | `.quit-btn`、`.history-action.danger`、`.pet-remove` |
| `ghost` | 圖示按鈕 | `.header-btn`、`.pet-edit` |

尺寸只留 `sm` / `md` 兩級，字級分別 `var(--font-xs)` / `var(--font-sm)`。

**(c) 進度條 → 一個 `ui/ProgressTrack.vue`**

統一高度 6px、`--radius-pill`，顏色由 `tone` prop 決定（`accent` / `success` / `warn` / `error`）。取代 §P0-4(c) 列出的全部軌道（`.switch-track` 除外，它屬於 Toggle）。

**(d) 導覽形態統一為一種**

這是感受落差最大的一項。建議**兩層都改用同一組水平 pill tabs**：

```
┌──────────────────────────────────────────┐
│  Agent Pets                      ⚙  ✕   │  ← header
├──────────────────────────────────────────┤
│  工作階段 │ 用量 │ 歷史 │ 設定           │  ← 單層 tabs，設定升為同級
├──────────────────────────────────────────┤
│  （進入設定後，此列變為設定的六個分頁）    │
└──────────────────────────────────────────┘
```

即：把 `panelView`（sessions/settings）與 `dashboardTab` 兩層壓平成一層，「設定」成為第四個 tab；進入設定後 tab 列切換為設定的六個分頁，並在左側顯示返回鍵。**全程只有一種導覽形態**，且省掉一層階層（詳見 3.6）。

若六個設定分頁在 400px 寬放不下，改為可橫向捲動的 tab 列，或先做 3.3 的 560px 寬設定視圖再搭配側欄——但**不要兩種形態並存**。

**(e) 補齊 hero 一致性**

`growth` 與 `pets` 兩個分頁補上 hero card，或**六個全部移除 hero，改用 `settings-content-header` 的 kicker + 標題**（`:610-613` 已存在）即可。後者較省，且能為擁擠的面板省下一整塊垂直空間——建議採後者。

**(f) 圖示語彙統一**

移除 `文 / ◈ / ⌘ / ✦ / ↗ / ⋯` 這組混雜字符，改用單一來源的 inline SVG（16×16，`currentColor`，1.5px stroke）。專案無外部圖示庫依賴，手寫 6 個 SVG 存於 `ui/icons/` 即可，避免引入相依。

改用 SVG 除了統一語彙，也是**跨平台一致性的必要條件**：SVG 的字形不依賴系統字型，Windows 與 macOS 渲染結果相同（見 P0-4f）。`⌘` 尤其必須換掉——它在 macOS 上有明確的 Command 鍵語意，用來代表「桌面行為」分頁會誤導 Mac 使用者。

**(g) 清掉死樣式**

移除 `.settings-tabs` / `.settings-tab` 殘留 CSS。

### 3.6 操作手順重新設計（對應 P0-5）

**(a) 導覽壓平為一層**

如 3.5(d)，`panelView` + `dashboardTab` 合併為單一 `activeTab`。效益：

| 動作 | 現況步數 | 改後 |
| --- | --- | --- |
| 開設定 | 3（寵物 → 齒輪 → 分頁） | 2（寵物 → 設定 tab） |
| 從設定回用量 | 3（返回 → 用量 tab） | 1 |

header 的齒輪按鈕在此設計下可移除（設定已在 tab 列），header 只留關閉鍵，更乾淨。

**(b) 托盤選單瘦身，消除雙真相來源**

托盤選單**只保留無法或不便在面板內完成的項目**：

```
顯示/隱藏寵物
開啟控制面板
─────────────
勿擾模式          ← 唯一保留的開關（高頻、需要在不開面板的情況下切換）
─────────────
結束
```

移除：音效、通知、權限泡泡、Presentation MCP、開機時啟動、迷你模式、邊緣停靠、開啟設定。這些全數改由面板的設定分頁作為**唯一**入口。

理由：托盤選單無法顯示說明文字，六個裸開關的名稱（如「Presentation MCP」）對使用者沒有意義；而設定頁的 `setting-help` 有完整說明。保留勿擾是因為它是「臨時、高頻、需要立刻生效」的操作，符合托盤的使用情境。

**(c) 面板記住上次位置，不再強制重置**

修改 `agentStore.ts:1132-1136`：

```ts
function handlePanelOpened() {
  // 保留 activeTab —— 使用者重新打開面板時回到離開時的位置。
  // 僅在超過閒置門檻（例如 5 分鐘）後才重置回 sessions。
  if (Date.now() - lastClosedAt > PANEL_STATE_TTL_MS) activeTab.value = 'sessions'
  showWizard.value = false
  showProjectMcpPanel.value = false
}
```

同時：**面板處於設定視圖時，暫時停用 blur-hide**（`electron/main.ts:808`）。設定是需要專注的任務，不該因為點到別的視窗就消失。Sessions/Usage/History 這類「瞄一眼」的視圖維持現有 blur-hide 行為。

**(d) 啟用寵物右鍵選單**

`DesktopPet.vue:271` 的 `@contextmenu.prevent` 改為開啟輕量選單（渲染在寵物視窗內，維持透明玻璃風格，不用原生 Menu）：

```
勿擾模式        ⌥
迷你模式
─────────────
開啟控制面板
設定
─────────────
隱藏寵物
```

這條路徑讓高頻操作從 3–4 步降到 2 步，且是桌面寵物使用者的直覺預期。

**(e) 破壞性操作改用面板內對話框**

以 3.4 的 `ui/ConfirmDialog.vue` 取代三處 `window.confirm`，解決搶焦點導致面板收起的問題（見 P1-4、P0-5(b)）。

**(f) 補鍵盤路徑**

- `Esc`：設定視圖 → 返回上層；面板 → 關閉
- `Ctrl/Cmd + ,`：面板開啟時直接跳設定分頁
- 全域快捷鍵（可設定，預設關閉）：喚出/收起面板
- tab 列支援 `←` / `→` 切換（`role="tablist"` 的標準鍵盤行為，目前缺）

**(g) 設定精靈移出「進階」**

新使用者的首要任務不該與「重新啟動」「結束」並列。建議：

- Sessions 視圖在**尚未偵測到任何 agent 事件**時，空狀態（`:384-386` 目前只有一行「目前沒有作用中的工作階段」）改為顯示「開始設定」的引導卡片，直接打開精靈。
- 設定側欄新增獨立的「開始設定」項，或置於「語言」分頁之上。

**(h) Project MCP 面板改為設定分頁**

目前它是 680×720 的獨立覆蓋層，造成視窗尺寸暴跳（P0-1）。改為設定的第七個分頁，套用 3.3 的 560px 設定寬度即可容納，路徑從 5 步降到 2 步，且不再有形變動畫。

### 3.7 i18n 補完

1. `STATE_LABELS` / `STATE_LABELS_SHORT` / `SOURCE_LABELS` 從 `types/agent.ts` 移除硬編碼，改為 i18n key（`state.thinking`、`state.waitingPermission`…）。`types/` 只保留 `STATE_COLORS` 與 `STATE_PRIORITY` 這類非文案常數。
2. `StatusPanel.vue:329-330` 兩段中文改走 `t('removePetConfirm', { name })` / `t('hidePetConfirm', { name })`。
3. 加一條測試：掃 `src/**/*.{vue,ts}`，`<template>` 與字串常值中不得出現 CJK 字元（`i18n.ts` 與 locale 檔案除外）。與 3.2 的 hex 檢查同一支腳本即可。

### 3.8 確認對話框

`ConfirmDialog.vue` 以既有的 `Transition name="wizard"` 覆蓋層模式實作（`App.vue:275-280` 已有），支援：標題、說明、危險語氣（`--state-error`）、Enter/Esc 鍵盤操作、focus trap。取代三處 `window.confirm`，順帶解掉「原生對話框搶焦點導致面板收起」的問題。

### 3.9 無障礙修補

- `.pet-option` 由 `<div>` 改 `<button type="button">`，`aria-pressed` 綁選中狀態。
- `dashboard-tabs` 補 `aria-controls` + 對應 `role="tabpanel"` 與 `tabindex="0"`。
- 全域焦點樣式收進 token：`--focus-ring: 2px solid var(--state-info)`，於 `ui/` 原子元件統一套用，不再逐處手寫。
- `prefers-reduced-motion: reduce` 加一條全域規則，把 54 處 transition/animation 一次降級，不需逐一改。

### 3.10 淺色主題（可延後）

token 層就位後，淺色只是多一組 `@media (prefers-color-scheme: light)` 的變數覆寫。**在 token 完成前不要嘗試**，否則等於再抄一次 121 個顏色。

---

## 4. 落地順序

以「不阻擋 Codex 併行加功能」為前提排序。每一階段獨立可交付、可回退。

### Phase A — 地基（不改任何畫面外觀）

1. 建立 `src/styles/tokens.css`，值直接沿用現有最常出現的顏色，**確保 diff 後畫面像素級不變**
2. 加入 hex / CJK 檢查腳本，先設為 warning
3. `STATE_LABELS` 系列改走 i18n（P1-2）
4. `StatusPanel.vue:329-330` 硬編碼中文改走 i18n（P1-3）

風險：低。與 Codex 的功能分支衝突面小（集中在 `types/agent.ts` 與 `i18n.ts`）。

### Phase B — 原子元件與拆檔（解決「不統一」）

1. 建立 `ui/`：`Button.vue`、`Card.vue`、`ToggleRow.vue`、`ProgressTrack.vue`、`ConfirmDialog.vue`、`icons/`（3.4、3.5）
2. StatusPanel 拆成 `panel/` + `dashboard/` + `settings/sections/`
3. 拆檔過程中，12 種按鈕 → 4 個 variant、5 套卡片 → 1 個 Card、9 種軌道 → 1 個 ProgressTrack
4. 補齊 hero 一致性（3.5e，建議六個分頁一律移除 hero）、換掉混雜圖示（3.5f）、刪 `.settings-tabs` 死樣式（3.5g）
5. 樣式改吃 token，檢查腳本轉為 error

風險：中。**必須與 Codex 協調時間窗**——這是唯一會大範圍動 `StatusPanel.vue` 的階段，建議選在 Codex 的階段交付之間執行，並在開始前先把該檔的既有變更合入。

**這是「風格不統一」體感消失的階段。**

### Phase C — 導覽與手順（解決「點擊不順」）

1. 導覽壓平：`panelView` + `dashboardTab` 合併為單一 `activeTab`，兩層 tabs 統一為一種形態（3.5d、3.6a）
2. 托盤選單瘦身至 4 項，消除與設定頁的雙真相來源（3.6b）
3. 面板記住上次分頁；設定視圖停用 blur-hide（3.6c）
4. 啟用寵物右鍵選單（3.6d）
5. 三處 `window.confirm` 換成 `ConfirmDialog`（3.8）
6. 鍵盤路徑：Esc、Ctrl+,、tab 列方向鍵（3.6f）
7. Project MCP 由獨立彈窗改為設定分頁（3.6h）；設定精靈移至空狀態引導（3.6g）

風險：中。托盤瘦身（步驟 2）會改變既有使用者的肌肉記憶，建議在版本說明中明確告知。步驟 3 需驗證 blur-hide 的條件式停用不會造成面板無法關閉。

**這是「手順不順」體感消失的階段。**

### Phase D — 尺寸與版面

1. 面板改 ResizeObserver 內容驅動（3.3）
2. 基準寬度 380 → 400 / 560
3. 字級全面套 token，下限 11px
4. History 視圖改兩欄卡片版面

風險：中。需要在**兩個平台**實測 `computePanelBounds`（`electron/main.ts:824-862`）的邊界貼齊行為：

- Windows：100% / 125% / 150% DPI、多螢幕混合縮放
- macOS：Retina 與非 Retina、選單列與 Dock 佔用的 `workArea` 差異、多桌面（Spaces）切換

`workArea` 在 macOS 上會扣掉選單列與 Dock，Windows 上扣掉工作列，兩者的可用區形狀不同，內容驅動的高度夾制上限需分別驗證。

> Phase C 與 D 可對調，但 **C 先做的效益較高**：導覽壓平後，設定視圖不再需要側欄，380px 寬的壓迫感先減輕一半，D 的尺寸調整幅度也會變小。

### Phase E — 打磨

1. 無障礙修補（3.9）
2. 設定分頁的分組重整（音效與 Presentation MCP 移出「注意力」群組）
3. 淺色主題（3.10）

---

## 5. 給 Codex 併行開發的五條約定

在重設計期間，新功能請遵守以下五點，可讓後續合併成本接近零：

1. **新樣式一律使用 token 變數，不寫裸 hex / rgba。** Phase A 之後 `tokens.css` 就存在。
2. **新的使用者可見文案一律進 `i18n.ts`。** 不在 `.vue` 或 `types/` 寫死字串。
3. **新增設定項請新建檔案於 `settings/sections/`，不要繼續往 `StatusPanel.vue` 追加。** Phase B 之前若目錄尚未建立，請在 PR 描述中標註新增的行號區間，方便拆檔時搬移。
4. **不要新增按鈕/卡片/進度條的樣式類別。** Phase B 之後一律用 `ui/` 的元件加 variant；之前請沿用現有最接近的類別，不要再開第 13 種按鈕。
5. **新功能不要同時放進托盤選單與設定頁。** 預設只進設定頁；確實需要在不開面板時操作的，才在 PR 中說明理由並加入托盤。

---

## 6. 附錄：問題與檔案位置對照

| 編號 | 問題 | 位置 |
| --- | --- | --- |
| P0-1 | 視窗尺寸硬編碼 | `src/stores/agentStore.ts:1105-1128` |
| P0-1 | Sessions 列表 max-height 與視窗高度衝突 | `src/components/StatusPanel.vue:1488-1492` |
| P0-1 | SetupWizard 寬度期望與實際不符 | `src/components/SetupWizard.vue:270-282` |
| P0-2 | 表面色三種不一致 | `StatusPanel.vue:988`、`SetupWizard.vue:274`、`ProjectMcpPanel.vue:252` |
| P0-3 | 9–10px 主力字級 | `StatusPanel.vue:1174-1213`、`:1277-1300`、`:1609-1616` |
| P0-4a | 五套卡片樣式 | `StatusPanel.vue:1124`（usage-provider）、`:1713`（hero-card）、history-card 群、`ProjectMcpPanel.vue` |
| P0-4b | 十二種按鈕樣式 | `StatusPanel.vue:1041`、`:1078`、`:1227`、`:1291`、`:1618` 等 |
| P0-4c | 九種進度條軌道 | `StatusPanel.vue:1186`（quota-track）、mood/progression/history 各軌道 |
| P0-4d | 兩種導覽形態並存 | `StatusPanel.vue:1071-1102`（pill tabs）vs `:1601-1650`（側欄） |
| P0-4e | 六分頁只有四個有 hero | `StatusPanel.vue:614`、`:642`、`:693`、`:949`（growth/pets 缺） |
| P0-4f | 圖示語彙混雜，且字符跨平台渲染不一致 | `StatusPanel.vue:15-22` |
| P0-4g | `.settings-tabs` 死樣式殘留 | `StatusPanel.vue`（template 無引用） |
| P0-5a | 托盤與設定頁重複 6 個開關 | `electron/desktop-tray.ts:74-133` vs `StatusPanel.vue:727-792` |
| P0-5b | 面板重開強制重置視圖 | `src/stores/agentStore.ts:1132-1136`、`electron/main.ts:808` |
| P0-5c | 寵物右鍵被吃掉且無作用 | `DesktopPet.vue:271`、`:231-240` |
| P0-5d | Project MCP / 設定精靈埋在進階分頁 | `StatusPanel.vue:958-969` |
| P0-5e | 設定頁無 Esc 返回 | `StatusPanel.vue:329-335` |
| P1-1 | 單檔 2,561 行 | `src/components/StatusPanel.vue` |
| P1-2 | 狀態標籤硬編碼英文 | `src/types/agent.ts:65-107` |
| P1-3 | 硬編碼中文確認訊息 | `src/components/StatusPanel.vue:329-330` |
| P1-4 | 原生 confirm | `StatusPanel.vue:165`、`:331`、`ProjectMcpPanel.vue:87` |
| P2-1 | 設定側欄擠壓內容區 | `StatusPanel.vue:1595-1607` |
| P2-2 | 寵物選項非按鈕 | `StatusPanel.vue:863-869` |
