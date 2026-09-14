# Phase 11 — Desktop Visibility

日期：2026-09-14
基線版本：`1.1.4`
版本狀態：未升版、未建立 tag、未提交 commit。Windows 功能已完成程式與封裝 gate；外部全螢幕的 Windows 桌面矩陣仍需在可操作的使用者 desktop session 完成，因此尚未進入版本確認 gate。

## 本次完成範圍

- 在 **Settings → Desktop → 桌面行為** 保留三個持久化開關；全部預設關閉，unsupported 或失效的 native capability 會由 main process 投影為 disabled。
- Capture exclusion 只對 pet `BrowserWindow` 套用 `setContentProtection()`，panel 仍可擷取。Windows capability 為 system、macOS 為 limited；Linux 不宣稱支援。
- macOS fullscreen auto-hide 維持 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })` 的原生 Spaces policy，套用到 pet 與 panel；從 Tray 顯示寵物時使用 `showInactive()`。
- Windows 新增 `koffi@3.2.1` production dependency 與 `electron/windows-fullscreen-detector.ts`。Detector 載入 `user32.dll`／`dwmapi.dll`，以 `SetWinEventHook` 觀察 foreground、move/size、minimize、show/hide/location 事件，使用 50ms debounce 重新檢查目前前景視窗。
- Windows 只接受不同 process 的可見、非 minimized／非 cloaked、頂層、無 caption／resize frame，且 DWM extended frame bounds 與完整 monitor bounds 相符的視窗。符合時，只有與該 monitor 相同的 pet／panel 會自動隱藏；退出條件後只恢復本次由 detector 隱藏的視窗。
- Permission request 存在時不自動隱藏 pet，避免把必須由使用者處理的控制卡藏起來。使用者手動顯示／隱藏會清除 auto-hide marker，不會被後續狀態事件錯誤復原。
- Koffi／Win32 hook／evaluation 失效時 fail closed 停用 Windows capability、清除 persisted fullscreen toggle，並 fail open 恢復曾自動隱藏的視窗。Koffi 的 license 已加入 `THIRD_PARTY_NOTICES.md`，`pnpm-workspace.yaml` 允許其 install script 完成 native binary 安裝。
- Right-click hide 只接受 pet sprite 與 Edge Peek handle。Permission card、狀態、toast 與其他互動控制不會觸發；renderer 只送無 payload command，main 再驗證 trusted sender 與 persisted preference。

## 平台能力與安全邊界

Windows 使用 Win32 event hook、foreground HWND、DWM frame bounds、monitor bounds、visibility/style 與 process identity；不使用 focus／blur 推測、標題關鍵字、PowerShell、WMI、外部命令或無上限 polling。一般最大化視窗保留 caption／resize style 或只到 work area，不會被視為外部 fullscreen。自己的 Agent Pets 視窗、child window、cloaked／minimized window 與不完整覆蓋也不會觸發。

這不是影片內容辨識，也不保證辨認所有遊戲、媒體播放器、遠端桌面或硬體 overlay 的專用 fullscreen 模式。Capture exclusion 仍受 Windows 擷取 API 與 OS 版本支援度限制；macOS 的 sharing exclusion 仍是 best effort，不是 DRM。

## 驗收證據

| 條件 | 結果 |
|---|---|
| Capability projection | 通過：Windows native detector 成功時為 `windows-native`，載入／啟動失敗時為 `unsupported`；macOS 保留 `macos-native`；Linux 不宣稱 fullscreen。 |
| Native detector pure rule | 通過：115 個 unit tests 全部通過，涵蓋 borderless 完整 monitor、1px tolerance、maximized／owned／cloaked／minimized／child／mismatch rejection，以及 Electron native handle → Koffi pointer conversion。 |
| Native Windows binding | 通過：目前 Windows Node host 可載入 Koffi、建立 Win32 binding、註冊 8 組 event hook、`start()` 成功並由 `stop()` 解除。 |
| Windows packaging | 通過：`pnpm.cmd build` exit code 0；`release\\win-unpacked` 與 `release\\AgentPets-1.1.4.exe` 產出，且 unpacked resources 內含 `@koromix/koffi-win32-x64\\win32_x64\\koffi.node`。 |
| Packaged startup | 通過：隔離 user-data、`--disable-gpu` 啟動 packaged app 並保持執行；記錄中沒有 Windows fullscreen detector unavailable 訊息。受限環境仍有既有 `%USERPROFILE%\\.desktop-pet` EPERM 與 renderer frame disposed 訊息，不能當作使用者桌面矩陣通過。 |
| Type／unit／diff | `vue-tsc --noEmit` 通過；`pnpm.cmd test:unit` 為 `115/115`；`git diff --check` 通過。 |

## 尚未宣稱完成的實機驗收

- Windows 10／11 真實外部 app 的 fullscreen enter／exit：borderless game、Chrome／Edge F11、媒體播放器與一般最大化對照。
- Windows 多螢幕、負座標、DPI scaling、monitor 切換，以及 pet／panel 分別位於不同螢幕時的隱藏／恢復。
- 使用者桌面 session 中 Settings toggle enabled／disabled、Tray 顯示、Permission bubble 優先序與手動 show/hide override。
- macOS 實際 Spaces／Mission Control／多螢幕，以及 Screenshot、QuickTime、ScreenCaptureKit capture matrix；本輪只保留既有 macOS implementation contract，不能由 Windows 結果推論。

## 版本建議

目前維持 `1.1.4`。Windows native detector 是新的 platform/security boundary，依專案規則建議在上述 desktop session 矩陣完成、使用者確認後以 minor 版本升級至 `1.2.0`；本輪不自行修改版本或建立 commit。
