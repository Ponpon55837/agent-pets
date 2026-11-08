# 階段報告：插件面板主題（`panelThemes`）

分支 `feat/panel-themes`，基準 1.11.4（`3435de4`）。規格：`docs/design/Plugin-Panel-Theme-Spec.md`（§0 記錄實作時的決定）。版本尚未變更。

## 範圍與結果

| 規格章節 | 內容 | 狀態 |
| --- | --- | --- |
| §2 | manifest 驗證（執行期驗證為準、只拒絕不夾值）、免 Worker 規則（`skins`／`panelThemes`）、`invalid_panel_theme` 錯誤碼、開發者模式診斷 | 完成 |
| §3 | 封閉顏色語法與 `rgb(R G B / A)` 重新輸出、選填色推導、字型清單與尺寸、`tokens.css` 凍結內建值（`--builtin-organic-*`）與 `.host-protected` | 完成 |
| §3.7 | 寵物狀態列顏色 `petStatus`（新增，見規格 §3.7） | 完成 |
| §4 | 背景（純色／漸層／圖片＋遮罩）、woff2 字型、使用者匯入背景圖（原生對話框、記憶體內驗證、`userData/panel-theme-images`、0o700／0o600、temp＋rename、清除、孤兒清理） | 完成 |
| §5、§6 | 素材檢查、對比規則（各模式分開、最小遮罩、0.50 下限） | 完成 |
| §7 | `panel-theme.json`、同步與廣播、`agent-pets://panel-theme/<token>`、生命週期 | 完成 |
| §8 | 設定介面：依使用者決定移到「設定 → 插件 → 該插件 → 面板主題」；「通用 → 外觀」只留狀態卡與恢復內建 | 完成 |
| §10 | 授權單位、套件規則、目錄 `minAppVersion` 與探索頁「需要 Agent Pets X」 | 完成 |
| §16.4 | 插件讀取主題 API：`--ap-*` token、`theme.get()`／`theme.onDidChange`（規格 R13） | 完成 |
| §16 其餘 | 全介面統一主題（彈出視窗、按鈕、對話框等全部改用同一色盤） | **進行中**，工作清單見 `docs/design/theme-token-audit.md` |

## 與規格的差異

見規格 §0 R1–R11。重點：

- R1：`accentHover` 改為「往 text 混合到 onAccent 達 4.5:1 的第一個比例」，只給 10 個必填內建淺色值時原公式只有 4.43:1。
- R2／R3／R4：遮罩色必須不透明；圖片背景合成不取整；最小遮罩採「之後所有比例都通過」的定義。
- R6：設定位置改到插件詳情頁。
- R7：新增 `petStatus`（寵物狀態列）。
- R8：`agent-pets` scheme 加上 `corsEnabled`。字型一定是 CORS 請求，實測沒有它會被 Chromium 擋下；只有 `panel-theme` 路由會回 `Access-Control-Allow-Origin`，且只給面板來源。

## 安全

- 插件字串不會進入 CSS：主程式以封閉語法解析並重新輸出；渲染端用白名單與逐屬性正規式再檢查，只用 `style.setProperty`，不使用 `cssText`、`<style>` 或 `innerHTML`（有測試把關）。
- 沒有遠端網址；圖片與字型只能從 `agent-pets://panel-theme/<token>` 取得，token 為每次啟動不同的 HMAC，插件分區沒有這個 host。提供前會對讀到的位元組重跑檔頭檢查。
- 圖片只讀檔頭判斷尺寸、像素數、動畫與方向，不解碼；使用者圖片只讀一次（lstat、`O_NOFOLLOW`、fstat 比對 dev/ino/size）。
- 新 IPC：6 個面板頻道（只允許設定面板 main frame，含單向的 `panel-theme-appearance-set`）、1 個寵物頻道（只允許寵物視窗 main frame）、3 個由主程式送出的廣播（含送給插件面板頁的 `plugin-panel-theme-changed`）；`docs/security/ipc-inventory.md` 已重新產生，產生器也修正為依實際 sender guard 與 `_event` 參數判斷。
- 插件主題 API（`theme.get`、`theme.onDidChange`、面板頁 `--ap-*`）不需要權限：快照只含畫面上已可見的顏色、圓角、字族與字級倍率，每個插件相同，不含插件或主題 id、字型別名、圖片或路徑；變更以 100 ms 合併並在送出時去重。
- 權限／風險介面、安裝確認、插件內容框、確認對話框、伺服器狀態橫幅與主題設定本身標記 `.host-protected`，永遠使用內建配色；寵物視窗只有狀態列可套用顏色。

## 規格以外一併修正的問題

- 淺色寵物外觀下權限泡泡的指令、細節、連結與「允許一次」幾乎是白字配米色（沿用深色層的 `--text-bright` 等 token）。已在淺色寵物範圍補上對應值，並把這些配對加入 `check-contrast`。
- `rgb()` 百分比換算有浮點誤差（50% 變成 127）。
- `pack-test-plugin.mjs` 不支援免 Worker 的測試插件。
- 隔離測試執行器無法驅動原生檔案對話框、也無法改埠：新增僅供測試的對話框佇列，並轉傳開發版的埠設定。
- 已解析主題的快取改為只保留已安裝版本；多個元件同時掛載時共用同一個狀態請求。

## 驗證

- `pnpm exec vue-tsc --noEmit`、`pnpm run lint`、`pnpm run test:unit`（1098 項全過）、`pnpm exec vite build`、`pnpm run check:bundle-size`、`pnpm run check:bundle`、`pnpm run check:contrast`、`pnpm run check:design:strict`、`pnpm audit --prod`（無已知弱點）、`git diff --check`。
- 新增測試：顏色語法與注入字串、驗證器與對比、儲存、使用者圖片、IPC 寄件者、協定路由、渲染端白名單、寵物狀態列、插件整合（manifest、套件、授權、目錄、設定搜尋、語系）。
- 隔離 Electron（暫時 HOME／userData、假 safeStorage、未觸發鑰匙圈）：以開發者模式安裝測試主題插件，套用淺色與深色、匯入背景圖、切換插件停用／移除（檔案與設定一併清除）、權限卡在高彩度主題下維持內建外觀、forced-colors／prefers-contrast／reduced-transparency、寵物狀態列淺色與深色。

## 剩餘風險

- 字型：測試用 `.woff2` 只有檔頭，實際被 OTS 拒絕而改用備援字型；真正字型的渲染結果尚未驗證。
- 只在 macOS 驗證；Windows（高對比模式、字型、路徑）與 125%／150% 縮放未測。
- 規格 §16 的全介面統一主題尚未完成（插件讀取 API 與狀態色色相限制已完成）。
- 新增註解仍以英文為主，與專案技能「新增註解用繁體中文」不一致。

## 版本建議

Minor（1.12.0）：新的公開 manifest 契約、新的 IPC 與協定安全邊界、新的持久化檔案。依 `AGENTS.md`，待使用者確認後再變更版本。
