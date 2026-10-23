# Contribution points

Plugins can contribute notifications and reactions, expose settings and sanitized Agent status, or add an isolated custom panel page.

| Contribution | What users see | Priority and user actions |
|---|---|---|
| `feed` | A pet bubble with plugin source, title, body, optional icon and link; the item is also retained in the plugin notification center. | Bubble order: permission request/notice → presentation say → Agent toast → normal plugin feed → activity → low plugin feed. `normal` is the default; `low` appears after activity. Users can close, open an allowed link, mark read, or clear items. |
| `reaction` | The pet reacts with `happy`, `curious`, `thinking`, `surprised`, or `encouraging`. | Uses the normal Agent/plugin interaction queue and is rejected during DND. Users can disable the plugin or global switch. |
| `settings` | A manifest-schema form in the plugin panel. Secret fields are password inputs and their values are never echoed back. | The user saves the form. Background code can read settings and subscribe to changes, but cannot write them through the Host API. |
| `agentStatus` | No new bubble; it lets the plugin read current pet state and subscribe to changes. | Rapid changes are coalesced for one second per pet. The only fields are `petId`, `name`, `agentFamily`, `previousState`, `visibleState`, `dnd`, and `at`. |
| `panelView` | An HTML page in the settings panel, with a host-drawn plugin name, icon, “Plugin content” marker, and close button outside the page. | The page uses its own sandboxed `WebContentsView`. It can exchange bounded JSON messages with the same plugin's Worker; it cannot cover the host chrome or access the app renderer. See [Panel views](panel-view.md). |

Users can disable one plugin or all plugins, mute a plugin, adjust its notification rate, and choose a target pet. DND, hidden pets, and rate/queue limits route feed items to the notification center instead of a bubble.
