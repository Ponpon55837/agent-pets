# 插件問題回報

每個已安裝插件都有「回報問題」操作。主程序使用設定好的 HTTPS GitHub `/issues/new` 網址組成回報連結，只附上插件 ID、已安裝版本；若插件不在最近載入的目錄中，標題會加上本機安裝標記。不會附加使用者資料、檔案路徑或插件 log。

回報目的地不寫死在程式碼中。請在應用程式啟動環境設定 `AGENT_PETS_PLUGIN_ISSUE_REPORT_URL`，值為該發行版本要使用的 HTTPS GitHub issue form 網址，例如 `https://github.com/example/project/issues/new`。未設定或網址無效時，按鈕會顯示雙語提示，不會開啟任何內容。

隔離 Electron 啟動器會把 `shell.openExternal` 換成記錄器。端對端檢查可讀取 `globalThis.__agentPetsE2E.shellOpenExternalCalls`，不會啟動真實瀏覽器。
