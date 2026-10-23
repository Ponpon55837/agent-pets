# 範例

這些原始碼只供參考，放在文件資料夾，不會打包或隨 App 發佈。每個範例的 `plugin.json` 都由測試呼叫正式 `parsePluginManifest` 驗證。

- [hello-feed](examples/hello-feed/)：入門教學的完成版；載入後顯示一則泡泡。
- [github-pr-watch](examples/github-pr-watch/)：示範 manifest host allowlist、`network.userGranted`、`secrets`、`settings`、`schedule` 與 `dedupeKey`。設定面板需存入 `githubToken` secret；若無 token，GitHub API 可能有較低的匿名速率上限。範例不記錄 token。
- `panel-demo`：預計 P15 提供。
- `pomodoro`、`skin-pack`：預計 P16 提供。

先照[入門教學](getting-started.zh-TW.md)建立 `hello-feed`，再閱讀[API 參考](api-reference.zh-TW.md)與[安全須知](security.zh-TW.md)。
