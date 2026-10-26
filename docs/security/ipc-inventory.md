# IPC 安全清單

由 `node scripts/generate-ipc-inventory.mjs --write` 從 `electron/main.ts`、`electron/preload.ts` 與 `electron/plugin-ui-preload.ts` 產生；目前 83 個 handler。每列列出 sender guard、handler 中的輸入檢查概況、preload 對應與測試。新增 IPC 頻道若未同步 preload 或 sender 驗證，`tests/ipc-inventory.test.mts` 會失敗。

| 頻道 | 類型 | 允許的寄件者 | 輸入驗證概況 | Preload API | 對應測試 |
| --- | --- | --- | --- | --- | --- |
| `plugin-feed-unread-count` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | onPluginFeedUnreadCount (on)<br>getPluginFeedUnreadCount (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-badges-get` | `handle` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getPluginBadges (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-event-source-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getPluginEventSourceStatuses (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-skin-fallback-notify` | `handle` | 受信任寵物或設定面板 main frame | 長度／數量上限；isPluginSkinPetId；無效輸入回安全預設或錯誤 | notifyPluginSkinFallback (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-feed-complete` | `handle` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | completePluginFeed (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-feed-open-link` | `handle` | 受信任寵物或設定面板 main frame | 型別；isPluginLinkHostAllowed；無效輸入回安全預設或錯誤 | openPluginFeedLink (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-snapshot` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getPluginPanelSnapshot (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-command-invoke` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | invokePluginCommand (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-view-open` | `handle` | 設定面板 main frame | 型別；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | openPluginPanelView (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-view-open-from-pet` | `handle` | 寵物視窗 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | openPluginPanelFromPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-view-bounds` | `on` | 設定面板 main frame | 型別；數值範圍；validatePluginPanelViewBounds；無效輸入回安全預設或錯誤 | setPluginPanelViewBounds (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-view-close` | `on` | 設定面板 main frame | 型別；數值範圍；無效輸入回安全預設或錯誤 | closePluginPanelView (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-api` | `handle` | panelView 主 frame；active WebContents 二次比對 | handler／controller 驗證 payload；拒絕無效輸入 | agentPets (createPluginPanelPublicApi) | `tests/ipc-inventory.test.mts` |
| `plugin-settings-get` | `handle` | 設定面板 main frame | 型別；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | getPluginSettings (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-settings-set` | `handle` | 設定面板 main frame | 型別；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | setPluginSettings (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-consent-get` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getPluginSecretConsent (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-consent-accept` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | acceptPluginSecretConsent (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-set` | `handle` | 設定面板 main frame | 型別；長度／數量上限；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | setPluginSecret (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-preferences-global-set` | `handle` | 設定面板 main frame | isPluginPanelPreferencePatch；無效輸入回安全預設或錯誤 | setPluginGlobalPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-catalog-list` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | listPluginCatalog (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-catalog-install` | `handle` | 設定面板 main frame | 型別；長度／數量上限；isPluginPanelPluginId, isPluginCatalogUrl；無效輸入回安全預設或錯誤 | installPluginFromCatalog (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-report-issue` | `handle` | 設定面板 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | reportInstalledPluginIssue (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-preferences-instance-set` | `handle` | 設定面板 main frame | 型別；isPluginPanelPluginId, isPluginPanelPreferencePatch；無效輸入回安全預設或錯誤 | setPluginInstancePreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-select` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | selectPluginArchive (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-select-folder` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | selectPluginFolder (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-confirm` | `handle` | 設定面板 main frame | 型別；isPluginPanelInstallConfirmation；無效輸入回安全預設或錯誤 | installPluginPlan (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-remove` | `handle` | 設定面板 main frame | 型別；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | removeInstalledPlugin (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-diagnostics` | `handle` | 設定面板 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | getPluginDiagnostics (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-list` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | listPluginNotifications (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-read` | `handle` | 設定面板 main frame | isPluginPanelNotificationId；無效輸入回安全預設或錯誤 | markPluginNotificationRead (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-clear` | `handle` | 設定面板 main frame | 型別；長度／數量上限；isPluginPanelPluginId, isFocused, validatePluginPanelViewBounds；無效輸入回安全預設或錯誤 | clearPluginNotifications (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-drag-start` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | startDrag (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-drag-end` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | notifyDragEnd (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-window-hover` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | notifyPetHover (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `shimeji-walk-step` | `on` | 寵物視窗 main frame | 型別；數值範圍；無效輸入回安全預設或錯誤 | shimejiWalkStep (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-mouse-passthrough` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | setMousePassthrough (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-hide-request` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | requestPetHide (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-toggle` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | togglePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-resize` | `on` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | resizePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-hide` | `on` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | hidePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-resize` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | resizeWindow (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-content-height` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | reportContentHeight (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-window-mode-set` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setPetWindowMode (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-window-mode-init` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | initializePetWindowMode (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-quit` | `on` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | quitApp (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-restart` | `on` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | restartApp (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-preferences-init` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | initializeDesktopPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-preferences-set` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setDesktopPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `power-save-state` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getPowerSaveState (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `presentation-status-update` | `on` | 寵物視窗 main frame | normalizePresentationStatus；無效輸入回安全預設或錯誤 | publishPresentationStatus (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `progression-init` | `handle` | 受信任寵物或設定面板 main frame | 型別；isProgressionPetId；無效輸入回安全預設或錯誤 | initializeProgression (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `progression-set-pet` | `handle` | 受信任寵物或設定面板 main frame | isProgressionPetId；無效輸入回安全預設或錯誤 | setProgressionPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `achievements-init` | `handle` | 受信任寵物或設定面板 main frame | isProgressionPetId；無效輸入回安全預設或錯誤 | initializeAchievements (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `permission-requests-init` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | initializePermissionRequests (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `permission-decide` | `handle` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | decidePermission (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `integration-status` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | checkIntegration (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-diagnose` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | diagnoseAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-install` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | installAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-uninstall` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | uninstallAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `quota-usage` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getQuotaUsage (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-summary` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | getHistorySummary (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-clear` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | clearHistory (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-export` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | exportHistory (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `test-integration` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | testIntegration (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `install-integrations` | `handle` | 設定面板 main frame | isIntegrationTarget；無效輸入回安全預設或錯誤 | installIntegrations (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | listProjectPets (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `project-pets-get-enabled` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getProjectPetsEnabled (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `project-pets-set-enabled` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setProjectPetsEnabled (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-pick` | `handle` | 設定面板 main frame | 長度／數量上限；無效輸入回安全預設或錯誤 | pickProjectPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-bind` | `handle` | 設定面板 main frame | 型別；isValidPetId；無效輸入回安全預設或錯誤 | setProjectPetBinding (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-archive` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | archiveProjectPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-setup` | `handle` | 設定面板 main frame | 長度／數量上限；無效輸入回安全預設或錯誤 | setupProjectMcp (invoke) | `tests/project-mcp-registry.test.mts`<br>`tests/project-mcp-setup.test.mts` |
| `project-mcp-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | listProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-remove` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | removeProjectMcp (invoke) | `tests/project-mcp-registry.test.mts` |
| `project-mcp-forget` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | forgetProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `uninstall-integrations` | `handle` | 設定面板 main frame | isIntegrationTarget；無效輸入回安全預設或錯誤 | uninstallIntegrations (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `load-pets` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | loadPets (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `add-custom-pet` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | addCustomPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `rename-custom-pet` | `handle` | 設定面板 main frame | 型別；長度／數量上限；無效輸入回安全預設或錯誤 | renameCustomPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `remove-custom-pet` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | removeCustomPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `get-custom-pet-sprite` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getCustomPetSprite (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `import-pet-zip` | `handle` | 設定面板 main frame | 長度／數量上限；isFile, isSupportedRasterImage；無效輸入回安全預設或錯誤 | importPetZip (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `import-pet-sprite` | `handle` | 設定面板 main frame | 長度／數量上限；isFile, isSupportedRasterImage；無效輸入回安全預設或錯誤 | importPetSprite (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |

## 分析規則

- `assertTrustedIpcSender` 與 `assertPluginPanelSender` 都確認 sender 的 main frame、可信 URL 與允許的視窗；具名視窗參數會限制至該視窗。
- `plugin-panel-api` 先要求 main frame，再由 `PluginPanelViewController.handleApiRequest` 驗證目前 active WebContents、方法 allowlist、JSON 形狀與訊息大小。
- 寄件者與 payload 不合法時，handler 依各 API 回傳既有安全預設值或錯誤結果。
