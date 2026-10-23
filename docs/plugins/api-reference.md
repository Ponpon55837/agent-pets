# Host API reference (apiVersion 1)

Successful calls return the values listed below directly. A failure rejects an `Error` whose `code` is one of the listed strings. Do not depend on internal error details. See [`agent-pets-plugin.d.ts`](agent-pets-plugin.d.ts) for TypeScript declarations.

| Method | Permission / result | Errors and copyable example |
|---|---|---|
| `feed.notify(item)` | `contributes.feed`; `{itemId, delivery}` | `invalid_request`, `host_not_allowed`, `rate_limited`, `queue_full`, `duplicate`, `disabled`, `not_permitted`. `await api.feed.notify({title:'Done',body:'Build passed.'})` |
| `pet.react(reaction, options?)` | `contributes.reaction`; `{accepted:true}` | `invalid_request`, `rate_limited`, `queue_full`, `not_found`, `disabled`, `not_permitted`. `await api.pet.react('happy')` |
| `pet.status()` | `permissions.agentStatus`; `PetStatusChange[]` | `not_permitted`, `agent_status_unavailable`, `disabled`. `const pets = await api.pet.status()` |
| `pet.onStatusChange(fn)` | `permissions.agentStatus`; unsubscribe function | Throws `not_permitted` or `invalid_request` immediately. `const off = api.pet.onStatusChange(s => api.log.info(s.visibleState))` |
| `net.fetch(url, options?)` | `permissions.network`; `{status,headers,body,isBase64Encoded?}` | `invalid_request`, `host_not_allowed`, `too_many_redirects`, `timeout`, `too_large`, `rate_limited`, `disabled`, `not_permitted`. `const r = await api.net.fetch('https://api.example.com/status')` |
| `net.requestHost(host, reason)` | `network.userGranted`; `{granted:true,host}` | `invalid_request`, `rate_limited`, `denied`, `host_not_allowed`, `disabled`, `not_permitted`. `await api.net.requestHost('api.example.com','Read release notes')` |
| `secrets.get(key)` | manifest `permissions.secrets`; `string` | `not_permitted`, `secret_unavailable`, `secret_not_found`, `disabled`. `const token = await api.secrets.get('githubToken')` |
| `settings.get()` | `contributes.settings`; non-secret settings object | `not_permitted`, `settings_invalid`, `disabled`. `const options = await api.settings.get()` |
| `settings.onChange(fn)` | unsubscribe function | Throws `invalid_request` immediately. Non-secret setting changes and secret additions, updates, or clears trigger the callback; the value contains non-secret settings only. Call `api.secrets.get(key)` from the callback to read an authorized secret. `api.settings.onChange(v => api.log.info(v.repository))` |
| `schedule.every(seconds, fn)` | manifest `permissions.schedule`; cancel function | Throws `not_permitted` or `schedule_invalid` immediately. `const cancel = api.schedule.every(300, refresh)` |
| `storage.get(key)` | `permissions.storage`; `{found,value}` | `invalid_request`, `too_large`, `disabled`, `not_permitted`. `const saved = await api.storage.get('etag')` |
| `storage.set(key,value)` | `permissions.storage`; `{stored:true}` | Same as `storage.get`. `await api.storage.set('etag','abc')` |
| `storage.remove(key)` | `permissions.storage`; `{removed:boolean}` | `invalid_request`, `disabled`, `not_permitted`. `await api.storage.remove('etag')` |
| `log.info/warn/error(...values)` | Plugin-panel diagnostic; `{logged:true}` | `invalid_request`, `too_large`, `disabled`. `await api.log.warn('Retrying', code)` |
| `ui.postMessage(data)` | `contributes.panelView`; `{delivered:boolean}` | `invalid_request`, `too_large`, `rate_limited`, `disabled`. `const result = await api.ui.postMessage({type:'refresh'})` |
| `ui.onMessage(fn)` | `contributes.panelView`; unsubscribe function | Throws `invalid_request` immediately. `const off = api.ui.onMessage(message => api.log.info(message.type))` |

`net.fetch` methods are `GET`, `POST`, `PUT`, `DELETE`, and `PATCH`. Allowed request headers are `accept`, `authorization`, `content-type`, `if-modified-since`, `if-none-match`, and `x-api-key`; request bodies are at most 256 KB. Only `content-type`, `etag`, `last-modified`, and `retry-after` response headers are returned. Binary bodies are base64 strings with `isBase64Encoded: true`. A `requestHost` reason is 1–120 characters.

`PetStatusChange` contains only `petId`, `name`, `agentFamily`, `previousState`, `visibleState`, `dnd`, and `at`. `net.fetch` requires HTTPS and public DNS; each of up to three redirects rechecks the hostname and DNS. Plugin network requests do not send or store cookies. Use an `authorization` header with a declared secret when an API requires authentication. Host API successes are direct values, not `{ok,value}` wrappers.

`ui.postMessage` and `ui.onMessage` exchange JSON values between a plugin Worker and its open panel page. Each message is limited to 256 KB and 20 per second per plugin and direction. A Worker message sent while the panel is closed resolves to `{delivered:false}` without being queued. The panel page API subset and browser restrictions are listed in [Panel views](panel-view.md).
