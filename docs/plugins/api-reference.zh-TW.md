# Host API 參考（apiVersion 1）

每個成功呼叫直接回傳下表的值；失敗會 reject 一個 `Error`，其 `code` 為下列錯誤字串。不要依賴錯誤訊息以外的內部資料。完整 TypeScript 宣告見 [`agent-pets-plugin.d.ts`](agent-pets-plugin.d.ts)。

| 方法 | 權限／回傳 | 失敗與可複製範例 |
|---|---|---|
| `feed.notify(item)` | `contributes.feed`；`{itemId, delivery}` | `invalid_request`, `host_not_allowed`, `rate_limited`, `queue_full`, `duplicate`, `disabled`, `not_permitted`。`await api.feed.notify({title:'Done',body:'Build passed.'})` |
| `pet.react(reaction, options?)` | `contributes.reaction`；`{accepted:true}` | `invalid_request`, `rate_limited`, `queue_full`, `not_found`, `disabled`, `not_permitted`。`await api.pet.react('happy')` |
| `pet.status()` | `permissions.agentStatus`；`PetStatusChange[]` | `not_permitted`, `agent_status_unavailable`, `disabled`。`const pets = await api.pet.status()` |
| `pet.onStatusChange(fn)` | `permissions.agentStatus`；解除訂閱函式 | 同步拋 `not_permitted` 或 `invalid_request`。`const off = api.pet.onStatusChange(s => api.log.info(s.visibleState))` |
| `net.fetch(url, options?)` | `permissions.network`；`{status,headers,body,isBase64Encoded?}` | `invalid_request`, `host_not_allowed`, `too_many_redirects`, `timeout`, `too_large`, `rate_limited`, `disabled`, `not_permitted`。`const r = await api.net.fetch('https://api.example.com/status')` |
| `net.requestHost(host, reason)` | `network.userGranted`；`{granted:true,host}` | `invalid_request`, `rate_limited`, `denied`, `host_not_allowed`, `disabled`, `not_permitted`。`await api.net.requestHost('api.example.com','Read release notes')` |
| `secrets.get(key)` | manifest `permissions.secrets`；`string` | `not_permitted`, `secret_unavailable`, `secret_not_found`, `disabled`。`const token = await api.secrets.get('githubToken')` |
| `settings.get()` | `contributes.settings`；非密鑰設定物件 | `not_permitted`, `settings_invalid`, `disabled`。`const options = await api.settings.get()` |
| `settings.onChange(fn)` | 回傳解除訂閱函式 | 立即同步拋 `invalid_request`。一般設定變更，以及密鑰新增、更新或清除都會觸發 callback；傳入值只含非密鑰設定。請在 callback 中呼叫 `api.secrets.get(key)` 讀取已授權密鑰。`api.settings.onChange(v => api.log.info(v.repository))` |
| `schedule.every(seconds, fn)` | manifest `permissions.schedule`；取消函式 | 同步拋 `not_permitted`、`schedule_invalid`。`const cancel = api.schedule.every(300, refresh)` |
| `storage.get(key)` | `permissions.storage`；`{found,value}` | `invalid_request`, `too_large`, `disabled`, `not_permitted`。`const saved = await api.storage.get('etag')` |
| `storage.set(key,value)` | `permissions.storage`；`{stored:true}` | 同上。`await api.storage.set('etag','abc')` |
| `storage.remove(key)` | `permissions.storage`；`{removed:boolean}` | `invalid_request`, `disabled`, `not_permitted`。`await api.storage.remove('etag')` |
| `log.info/warn/error(...values)` | 插件面板診斷記錄；`{logged:true}` | `invalid_request`, `too_large`, `disabled`。`await api.log.warn('Retrying', code)` |

`net.fetch` 的 method 為 `GET`、`POST`、`PUT`、`DELETE`、`PATCH`；可送出的 header 僅 `accept`、`authorization`、`content-type`、`if-modified-since`、`if-none-match`、`x-api-key`。Request body 最多 256 KB。回應只保留 `content-type`、`etag`、`last-modified`、`retry-after`；二進位 body 以 base64 字串回傳並設 `isBase64Encoded: true`。`requestHost` 的 reason 為 1–120 字。

`PetStatusChange` 僅含 `petId`、`name`、`agentFamily`、`previousState`、`visibleState`、`dnd`、`at`。`net.fetch` 僅允許 HTTPS 公開 DNS 網域；最多 3 次 redirect，每一跳都重新驗證網域與 DNS。插件網路請求不會送出或儲存 Cookie；需要登入時，請使用 `authorization` header 與已宣告的密鑰。Host API 成功直接回傳，不包 `{ok,value}`。

`net.fetch` 的 method 為 `GET`、`POST`、`PUT`、`DELETE`、`PATCH`；可送出的 header 僅 `accept`、`authorization`、`content-type`、`if-modified-since`、`if-none-match`、`x-api-key`。Request body 最多 256 KB。回應只保留 `content-type`、`etag`、`last-modified`、`retry-after`；二進位 body 以 base64 字串回傳並設 `isBase64Encoded: true`。`requestHost` 的 reason 為 1–120 字。
