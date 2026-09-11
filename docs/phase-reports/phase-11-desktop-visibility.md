# Phase 11 — Desktop Visibility

日期：2026-09-11  
基線版本：`1.1.4`  
版本狀態：未升版、未建立 tag、未提交 commit。本 Phase 仍缺 Windows 外部全螢幕原生偵測，因此不標記為完整完成，也不進入版本確認 gate。

## 本次完成範圍

- 在 **Settings → Desktop → 桌面行為** 新增三個持久化開關；全部預設關閉。
- Capture exclusion 只對 pet `BrowserWindow` 套用 `setContentProtection()`，panel 仍可擷取。Windows capability 為 system、macOS 為 limited；不支援的平台由 main process 強制投影為 `false`。
- macOS fullscreen auto-hide 使用 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })` 的原生 Spaces policy，套用到 pet 與 panel；關閉開關會恢復既有的 fullscreen 可見政策。從 Tray 顯示寵物時使用 `showInactive()`，避免搶走第三方 fullscreen Space 的焦點。
- Right-click hide 只接受 pet sprite 與 Edge Peek handle。Permission card、狀態、toast 與其他互動控制不會觸發。Renderer 只送無 payload command；main 再驗證第一方 frame、pet window sender 與 persisted preference。
- 舊設定檔中的 unsupported visibility `true` 在 main projection 中變為 `false`，並在下一次設定寫入時清理為 `false`。
- 中斷恢復後移除了沒有 production caller 的預留 auto-hide controller／gate；沒有保留只在測試中可達的「未來程式碼」。

## 平台能力與未完成項目

Windows 的 `fullscreenAutoHide` capability 目前明確為 `unsupported`，設定會 disabled。Electron 的 `BrowserWindow`／`screen` API 不能可靠判定其他程式的 borderless fullscreen；本次沒有使用 focus／blur、標題關鍵字、PowerShell、WMI、輪詢或本 App 自己的 fullscreen event 假裝完成。

若要完成 Windows 外部全螢幕自動隱藏，需另行加入範圍固定的 Win32 native helper／N-API，並在 Windows 實機驗證 foreground HWND、monitor bounds、cloaked/minimized state、multi-monitor/DPI、packaging、簽章、啟停與 fail-open 行為。這是一個新的 native/security boundary，不能在 macOS 上用靜態型別或 mock 宣稱已驗收。

Capture exclusion 不是錄影開始／結束偵測，也不是 DRM。Windows 的系統排除受 OS 與擷取 API 支援度限制；macOS 的 Electron／NSWindow sharing exclusion 是 best effort，較新的 ScreenCaptureKit、DWM／硬體擷取或相機仍可能取得畫面。

## 驗收證據

| 條件 | 結果 |
|---|---|
| 設定與 capability | 三個 preference 由 main allowlist、持久化並投影；unsupported 值 fail closed。 |
| Capture | 只呼叫 pet window 的 `setContentProtection`，window recreate 與 preference update 會重新套用；panel 不受影響。 |
| macOS fullscreen | pet 與 panel 使用原生 Spaces policy；明確使用 Electron 預設 process transform，不假設 App 已是 UIElement。 |
| Right-click／IPC | 無 payload；可信 sender、pet window identity、main-owned switch 三層檢查；DOM target 使用獨立 data attribute，不改變透明區 hit-test。 |
| Dead-code review | 已 grep 呼叫路徑並移除沒有 production 入口的 visibility arbitration scaffold。 |

## 測試、建置與安全檢查

- `pnpm exec vue-tsc --noEmit`：通過。
- `pnpm exec vite build`：通過。
- `pnpm build`：通過，完成 macOS x64 app／DMG packaging；本機沒有有效 Developer ID，因此輸出未簽章，不能當作 release candidate。
- 針對性 desktop visibility／preference／window-mode／effects：10/10 通過。
- `pnpm test:unit`：110 tests 中 109 passed；唯一失敗是既有 `tests/presentation-stdio.test.mts` 在 macOS 固定 spawn `node.exe` 而收到 `ENOENT`，與本 Phase 無關。
- `git diff --check`：通過。
- Secret pattern scan：沒有命中；`rg` 無命中時的 exit code 1 是預期結果。
- `pnpm audit --prod --audit-level high`：0 個已知 production vulnerability。
- 完整 `pnpm audit --audit-level high`：既有 `electron-builder` 開發／封裝工具鏈帶入 28 個公告（4 moderate、24 high，主要為 `fast-uri`、`@xmldom/xmldom`、`js-yaml`）；本 Phase 沒有新增 dependency，runtime audit 為乾淨。需另行升級建置工具鏈，不在本次可見性功能範圍內。

## 尚未宣稱完成的實機驗收

- Windows 10／11 packaged capture exclusion，以及未實作的外部 fullscreen detector。
- macOS 實際 Spaces／Mission Control／多螢幕，以及 Screenshot、QuickTime 與 ScreenCaptureKit capture matrix。
- 右鍵在 Normal／Mini／Edge、Permission 顯示中與透明區的桌面實際 hit testing。

## 版本建議

目前維持 `1.1.4`。Windows 外部全螢幕能力完成並通過對應平台實機驗收前，不建議為完整 Phase 11 升版；若使用者接受先發 macOS／capture／right-click 子集，再依確認決定 patch 或 minor。
