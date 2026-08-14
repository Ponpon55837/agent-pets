# Phase 10 — Shimeji 行為引擎

日期：2026-08-14
基線版本：`0.11.0`
確認後版本：`0.12.0`（minor）
版本狀態：已完成版本升級，待提交 commit。

## 範圍

本階段加入可選、預設關閉的 Shimeji 自主行為，不改變 Agent Event Core 的 canonical state，也不接管 Permission Broker。既有 `waiting-permission`、`waiting-input`、thinking、tool-running、success、error 與拖曳行為仍具最高優先權。

交付內容：

- 共用純策略 `ShimejiScheduler`：idle／walk／sleep 的低頻排程、狀態搶占、walk step 上限與 sleep 門檻。
- renderer 端 cursor-look 與既有 click reaction／poke 路徑，未新增 OS cursor polling。
- main-owned `shimejiEnabled` 偏好，預設 `false`，由 Settings → Desktop → 桌面行為控制。
- 受驗證的 `behaviorManifest`：每隻寵物可宣告 walk／sleep row、frame 數與 timing；缺少能力時 scheduler 和動畫都回到 Idle。
- main process 的 `shimeji-walk-step` 受限 IPC：只允許可信 pet renderer、有限水平位移、Normal 模式、無拖曳／Permission／DND，並以目前 display work area clamp。
- main-owned AC／電池省電狀態 IPC；電池狀態下不執行 native autonomous step。
- 內建四隻寵物加入 walk manifest；`ikun` 與 `wolf-hood-cat` 另宣告 sleep row。

## Acceptance criteria 對照

| 條件 | 結果與證據 |
|---|---|
| Permission／waiting／error 可即時打斷自主行為 | `shimejiGate` 監聽 current state、Permission queue、DND、drag、window mode；變更時清 timer、reset scheduler、把 animation 設回 Idle；main IPC 再次檢查 Broker queue。純規則測試涵蓋 waiting-input／pending permission。 |
| 缺 walk／sleep sprite 安全回退 Idle | `parsePetBehaviorManifest` 僅接受 row `0..10`、frames `1..16`、timing `60..3000ms`；目前所有顯示寵物必須共同具備該能力才會產生 walk／sleep intent，缺少時不移動 native window。測試涵蓋 missing walk／sleep。 |
| 不離開 work area、不跨 display、不與 Edge 衝突 | main 以 `clampWindowBounds` 及 `screen.getDisplayMatching` 限定目前 work area；目標 display 不同時丟棄；只接受 Normal 模式，Mini／Edge／Edge dwell 不會被自主步驟改寫。 |
| DND／省電／背景降低更新頻率 | DND、Reduced Motion、`document.visibilityState !== visible`、`saveData`、低電量會停止 scheduler；AC／電池事件由 main 廣播，電池模式同時拒絕 native step。 |
| 多 pet 符合 CPU budget、沒有常駐高頻 OS window polling | 整個 DesktopPet window 只有一個 scheduler timer；一般 tick 至少 1.5 秒、walk step 1.8 秒，最多 4 段；沒有新增 `screen.getCursorScreenPoint()` polling，既有 polling 仍只限使用者拖曳。 |
| 連點與 cursor-look 不破壞 click-through／拖曳 | cursor-look 只使用既有 renderer `mousemove`，以 350ms throttle，沒有 preventDefault 或 native bounds 寫入；拖曳開始後 gate 立即停用，main 也拒絕正在 drag poll 時的 autonomous step。既有 click-through IPC 未改寫。 |

## 主要檔案

- `src/types/pet.ts`：manifest 型別、行為策略、scheduler 與 budget 常數。
- `electron/shimeji-behavior.ts`：Node test 可直接載入的純模組 facade。
- `electron/pet-behavior-manifest.ts`：自訂素材 manifest 的 allowlist／邊界驗證。
- `electron/desktop-preferences.ts`、`electron/main.ts`、`electron/preload.ts`、`src/env.d.ts`：main-owned preference、bounded step IPC、power-save IPC。
- `src/components/DesktopPet.vue`、`src/components/PetAnimation.vue`、`src/components/PetAnimation.css`：排程生命週期、cursor-look、manifest motion fallback。
- `src/components/StatusPanel.vue`、`src/locales/*.json`：獨立 Shimeji 開關與繁中／英文文案。
- `public/pets/*/pet.json`、`public/pets/pets.json`：內建 manifest。

## 驗證紀錄

- `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/*.test.mts`：**100/100 passed**。
- `vue-tsc --noEmit`：passed。
- `vite build`（renderer、main、preload）：passed。
- `pnpm audit --prod --audit-level moderate`：`No known vulnerabilities found`。
- source-scoped credential scan（排除 `node_modules`、`dist`、`release`、`.claude`）：沒有 credential-shaped literals。
- `git diff --check`：passed。
- 完整 `pnpm build`（版本升級後）：passed；建置前腳本只辨識並關閉本專案 Agent Pets，輸出 `release/AgentPets-0.12.0.exe` 與 `release/win-unpacked/`。第一次在受限 sandbox 執行時因 WMI `0x80041003` 被拒，改以同一既有 build 流程提升權限重試成功。
- Windows packaged smoke：隔離 user-data 啟動 `release/win-unpacked/Agent Pets.exe`，成功建立 `progression.sqlite`、`achievements.sqlite`、`history.sqlite`、`project-routing.sqlite`；測試程序與臨時目錄均已清除。

## 安全性檢查

- 新增 IPC 均在 main 以 `isTrustedIpcSender` 驗證；payload 只接受 finite number，main 再 clamp 至 `±24px`。
- renderer 無法指定 x／y、display、window mode 或任意檔案路徑；manifest 只輸入數字 row/frame/timing，不執行任何程式碼。
- autonomous step 不會在 DND、battery、drag、Mini／Edge、pending Permission 或跨 display 時執行；位置寫入採既有 window-state writer 並以 2 秒 debounce，避免 hot-path 同步磁碟 I/O。
- 沒有新增 HTTP、MCP、hook、credential 或遠端連線面；Presentation MCP 的 observe/presentation-only 邊界未改變。

## Liquid Glass／無障礙檢查

- 新設定沿用既有 `Card`／`ToggleRow` 與 design tokens，沒有新增裸色、巢狀玻璃或第二套面板 shell。
- cursor-look 與 walk/sleep 不繞過現有 `prefers-reduced-motion`；Reduced Motion 會直接停止自主排程。
- Permission bubble、Edge handle、透明區 click-through 與 drag hit testing 保持原有路徑。
- 本階段做了 packaged startup smoke，但尚未在實際多螢幕／DPI 組合上完成人工拖曳與長時間 walk 視覺錄影；這是下一輪手動確認項，不宣稱已完成跨平台視覺驗收。

## 殘餘風險與刻意不做

- 目前 walk 只做水平 bounded step，不做視窗攀爬、全 OS window graph、碰撞物理、跨螢幕移動或垂直平台。
- cursor-look 是寵物視窗內的節流 mousemove 反應，不讀取全域游標位置；因此不會增加常駐 OS polling。
- Battery API 在部分 Electron／桌面環境可能不存在；此時仍有 main powerMonitor gate、DND、Reduced Motion 與背景 gate。
- 未新增雲端排行榜、帳號、跨裝置同步、遠端 telemetry、生產力插件或任意第三方程式碼執行。

## 結論

功能、型別、測試、建置、packaged startup 與安全 gate 均已完成；使用者已確認後升級至 `0.12.0`，可提交本階段 commit。實際桌面上的多螢幕／DPI 與長時間 walk 視覺驗收仍列為後續手動確認項。
