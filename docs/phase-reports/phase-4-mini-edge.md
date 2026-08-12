# Phase 4 驗證報告：Mini／Edge Mode

日期：2026-08-12
目前版本：`0.7.1`
階段狀態：使用者已確認，版本升級與提交完成
版本／提交：`0.7.1`；Phase 4 變更已提交

## 本階段結果

Phase 4 將桌寵視窗加入 Normal、Mini、Edge 三種狀態，讓長時間常駐時可以降低干擾，同時保留目前的 click-through、拖曳、權限泡泡、Tray 與事件接收邊界。Edge Peek 是獨立、持久化且預設關閉的使用者選項；開啟後顯示專用 opaque Liquid Glass handle，不再裁切寵物本體。Mini／Edge 只改變 native window 的幾何與呈現，不改變 hooks、事件、XP、通知或 Permission Broker 的真實狀態。

## 使用者行為

- `Settings` 的 `Desktop` 分區：切換約 96px 的 Mini surface，或獨立開啟／關閉 Edge Peek。
- Tray 的 `Mini Mode` 與 `Edge Peek Mode`：提供相同的模式／偏好切換入口。
- Edge 開關關閉時，拖曳到螢幕邊緣不會觸發 dwell，也不會在重開後恢復 Edge。
- Edge 開關開啟後，在 Normal 模式拖曳寵物到任一 display 邊緣並放開，且邊緣距離不超過 24px；停留 650ms 後進入 Edge。
- Edge 顯示 42px 厚、96px 長的專用 handle／圖示；handle 本身是不透明、可互動的 native window，hover、click、鍵盤 Enter／Space 都會回到 Normal，拖曳也會接續正常 drag path。
- Edge 只會在 Normal 視窗確實貼近 work area 邊緣後進入；若保存的 Edge 狀態已不再貼邊，啟動時會安全回到 Normal。進入 Edge 前會保存完整 native bounds snapshot，hover／click／關閉 Edge 偏好時直接還原原本位置與尺寸，不從 handle 位置重新推算。
- 單純點擊、不含實際移動，不會觸發 edge dwell。
- 待處理 Permission Broker request 存在時，main process 強制回到 Normal，避免權限卡片被縮小或藏到螢幕外。
- app restart 優先使用保存的 display id；若 display 已不存在，依保存的 normal bounds 與目前 work area 重新 clamp。

## 實作範圍

- `electron/pet-window-mode.ts`：純幾何規則、negative monitor origin、96px Mini、42px × 96px Edge handle、650ms dwell。
- `electron/main.ts`：main-owned mode state、edge dwell、hover restore、permission guard、display-added／removed／metrics-changed re-home、mode IPC 與保存的 normal/display bounds。
- `electron/setup.ts`：向後相容解析 `window-state.json`，新增 mode、edge、display metadata 與 normal bounds；不信任資料會回退為安全預設。
- `electron/preload.ts`、`src/env.d.ts`、`src/stores/agentStore.ts`、`src/App.vue`：typed mode IPC、sanitized snapshot、事件清理與 renderer mirror。
- `electron/desktop-preferences.ts`、`electron/desktop-tray.ts`、`src/components/StatusPanel.vue`、`src/components/DesktopPet.vue`：持久化 Edge preference、Tray／Settings controls、可擴充設定導覽、專用 handle rendering 與既有 click-through 整合。
- `src/stores/agentStore.ts`、`src/App.vue`：Mood visuals presentation switch，保留 mood state／XP 真實資料不變。
- `tests/pet-window-mode.test.mts`：幾何、負座標螢幕、Mini anchor、dwell threshold、Edge peek contract。

## 安全與邊界檢查

- Native bounds 只由 main process 計算；renderer 不傳 x/y/width/height，也不能直接呼叫 Electron window API。
- 新增 IPC `pet-window-mode-set` 只接受 `normal`／`mini`，並使用既有 first-party sender validation；初始化與廣播只回傳 `{ mode, edge? }`。
- `window-state.json` 的 x/y/size、display id、mode、edge、normal bounds 全部做 finite／enum／正值驗證；bounds 會依目前 work area clamp。
- Edge mode 使用 handle-sized opaque window 並保持 `setIgnoreMouseEvents(false)`，避免透明裁切區塊造成不可見或不可點；Normal 模式仍由既有 hit-test 控制 click-through；permission request 會清除 Edge 狀態。
- display re-home 不保存 prompt、project path、token 或其他事件內容；沒有新增本地 server、憑證或執行命令路徑。
- Mini／Edge 不會改寫 permission request、notification attention、XP ledger 或 event ingestion，避免 presentation state 取代真實控制狀態。

## 驗證結果

| Gate | 結果 |
|---|---|
| `npx.cmd vue-tsc --noEmit` | 通過 |
| `npx.cmd vite build` | 通過：renderer 47 modules、main 18 modules、preload 2 modules |
| `npm.cmd run test:unit` | 通過，45／45 tests |
| Phase 4 targeted geometry tests | 通過：bounds clamp、negative origin、Mini anchor、dwell、Edge peek |
| `pnpm.cmd audit --prod --audit-level moderate` | `No known vulnerabilities found` |
| high-risk secret scan | 未命中 private key、AWS、GitHub、OpenAI 或 Slack token 樣式 |
| `git diff --check` | 通過 |
| 版本 gate | `package.json` 已由 `0.7.0` 升至 `0.7.1`；`pnpm-lock.yaml` 無專案版本欄位，不需變更 |
| 升版後 source gate | `npx.cmd vue-tsc --noEmit`、`npx.cmd vite build`、`npm.cmd run test:unit` 通過；`pnpm.cmd exec` 另受既有 no-TTY modules purge 保護而中止，未修改依賴 |
| `pnpm.cmd electron:dev` | 受目前 pnpm no-TTY module purge 保護而中止，未修改依賴 |
| `pnpm.cmd build` | 完成：`release\win-unpacked\Agent Pets.exe` 已更新；portable 壓縮產物也完成 |

## Native runtime gate

已使用隔離 user-data 啟動更新後的 `release\win-unpacked\Agent Pets.exe`；程序可保持執行。Packaged build 在目前環境沒有提供可連線的 remote-debugging page target，且桌面 session 的螢幕擷取回傳無效 handle，因此無法把 CDP／黑畫面冒充成 Mini／Edge 真實互動證據。這次已完成 packaged 啟動 sanity check，但仍未完成可視化拖曳流程證據。

因此以下項目仍需在可控的 Windows desktop session 由使用者操作確認：

- 100%／125%／150% DPI 下拖曳到雙螢幕各邊緣；
- Edge peek 的 hover 展開與透明區 click-through；
- display 拔除、工作列位置變更、app restart 後的 re-home；
- packaged `win-unpacked` 的實際 native bounds 與 Tray toggle。

## 殘餘風險

- Edge 的 hover restore 依賴實際 BrowserWindow 的 native bounds 與 renderer pointer flow；不同 Windows compositor／多螢幕 DPI 仍需實機確認。
- Saved display id 在 driver 更新後可能改變；fallback 已使用 saved normal bounds 與 `screen.getDisplayMatching`，但不保證能重建原本的物理螢幕。
- 目前 mode state 保存在既有 `window-state.json`，未新增 schema migration；舊檔會安全回到 Normal。
- Mini／Edge 尚未與 Shimeji 自主移動行為耦合，避免本階段擴大物理與動畫範圍。

## 確認後動作

使用者已確認 Phase 4；依 roadmap 的 contained additive feature 規則將 `0.7.0` 升為 `0.7.1`，並在版本／型別／build／測試／安全／diff gate 通過後建立 Phase 4 commit。
