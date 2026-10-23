# 畫面貢獻點

P14.6 可公開使用的項目如下。`panelView` 本階段尚未開放文件或自訂 UI 指南，預計 P15 才加入。

| 項目 | 使用者看到的內容 | 同時出現時的順序與操作 |
|---|---|---|
| `feed` | 寵物泡泡，含插件來源、標題、內文、可選圖示與連結；通知也保留在插件通知中心。 | 泡泡仲裁：權限請求／提示 → presentation say → Agent toast → normal 插件通知 → activity → low 插件通知。normal 預設，low 只在 activity 之後顯示。使用者可關閉、點擊連結、標記已讀或清除。 |
| `reaction` | 寵物做出 `happy`、`curious`、`thinking`、`surprised` 或 `encouraging` 反應。 | 排在一般 Agent / 插件互動佇列中；勿擾時拒絕。使用者可停用插件或總開關。 |
| `settings` | 插件面板內由 manifest schema 產生的設定表單；密鑰欄位以密碼欄呈現且不回顯。 | 表單由使用者儲存；背景程式可讀取設定並訂閱變更，不能以 Host API 改寫。 |
| `agentStatus` | 不新增泡泡；允許插件讀取目前寵物狀態並收到狀態變更。 | 每隻寵物的快速變更合併 1 秒；欄位只含 `petId`、`name`、`agentFamily`、`previousState`、`visibleState`、`dnd`、`at`。 |

使用者可在面板關閉插件、全域停用、靜音單一插件、調整通知速率及目標寵物。DND、寵物不可見或速率／佇列限制會讓通知進通知中心，而非泡泡。
