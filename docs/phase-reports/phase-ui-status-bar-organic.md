# UI Phase — Desktop Pet Status Bar Organic Restyle

日期：2026-08-18  
基準版本：`1.0.1`  
完成版本：`1.1.1`

## 範圍與判讀

本 phase 依 `C:\Users\dgh\Downloads\status-bar-handoff.md` 實作。交接文件的範圍限制為桌寵下方 status pill／quota pill 的視覺層；DOM、class name、quota 計算、閾值、動畫 trigger、animation name 與 timing 均維持不變。新增的 Organic token 只被 Desktop Pet status bar 使用，不改變其他畫面。

使用者另行指定：驗證完成後升版至 `1.1.1`；`Thinking`、`Idle`、`Error` 等 Agent technical state label 維持既有英文 canonical copy，不翻譯。版本更新留到本報告 gates 通過後執行。

## 已完成

- status pill 與 multi-pet status pill 改為暖棕 opaque glass：暖色 border、14px radius、既有 blur／sheen 層級保留。
- status pill body 使用 `Figtree` fallback；quota 百分比使用 `Caprasimo`，約 14px hero number。
- quota 色階改為 Organic palette：warning 保留暖金，critical 使用 warm brick red，正常 Codex 使用 sage，Claude 使用既有 Organic terracotta accent。
- quota meter 底角改為 14px；tooltip 改為暖棕 surface、terracotta border、12px radius。
- 加上狀態列的 visible keyboard focus ring，以及 high-contrast／reduced-transparency opaque fallback。
- 未修改 `STATE_LABELS_SHORT`、狀態映射、quota math、quota 閾值、`quota-critical`／`quota-drain`／`quota-pulse`／`quota-heartbeat`／`quota-alarm`／`quota-sheen` 的既有契約。

## 驗證證據

| Gate | 結果 |
| --- | --- |
| `pnpm.cmd exec vue-tsc --noEmit` | 通過；並由最終 `pnpm.cmd build` 再次執行 |
| `pnpm.cmd test:unit` | `102/102` 通過 |
| `pnpm.cmd build` | 通過 Vite renderer、Electron main/preload、Windows unpacked 與 portable packaging；本次 pre-version artifact 為 `release\\AgentPets-1.0.1.exe` |
| Packaged Electron smoke | 以 `release\\win-unpacked\\Agent Pets.exe`、isolated temporary profile、CDP 實際 renderer 驗證；兩個 status pill 均存在並帶 quota |
| Runtime style assertions | 正常模式實測暖棕 `rgba(46, 43, 37, 0.88)`、Figtree、Caprasimo `14.5px`、14px pill／meter radius、暖棕 tooltip、terracotta `rgba(198, 113, 57, 0.36)` border、12px tooltip radius |
| Accessibility media assertions | `prefers-reduced-transparency` 實測 opaque `rgb(36, 29, 22)` 且 `backdrop-filter: none`；`prefers-contrast: more` 實測同一暖色 fallback 與高對比 border |
| `pnpm.cmd audit --prod --audit-level=high` | `No known vulnerabilities found` |
| Secret scan | 變更 diff 未發現 API key、secret、password、private key、access token 或 bearer token |
| `git diff --check` | 通過 |

## 安全與相容性

本 phase 只有 renderer CSS、quota CSS custom-property value 與 shared design token 變更，沒有新增或修改 IPC、local HTTP、filesystem、credential、hook、notification、permission 或 MCP trust boundary。既有 Agent state labels 與 technical vocabulary 保持 canonical English。

## 殘餘風險

- 本次已在 Windows packaged Electron 實測；macOS／Linux packaged rendering、實際 light/dark/high-detail wallpaper 組合尚未在本環境執行，不能由 Windows 結果推論。
- `Figtree`／`Caprasimo` 若未由使用者環境提供，會依 token fallback 到既有系統字型；本 phase 沒有引入遠端 font download。
- 專案目前沒有 status bar 的 pixel-diff visual regression harness；本報告的 UI 證據是實際 Electron computed-style／media-emulation smoke。

## 版本結果

功能與安全 gates 已完成，並依使用者指定把 `package.json` 更新為 `1.1.1`。`pnpm-lock.yaml` 沒有 root package version metadata；升版後 frozen lockfile check 通過且沒有產生 lockfile diff。升版後重新執行的 type-check、unit（`102/102`）、Windows packaged build、audit 與 diff gates 均通過，最終 portable artifact 為 `release\\AgentPets-1.1.1.exe`；同一份 `release\\win-unpacked` 也完成 final Electron smoke。
