# Reporting plugin issues

Each installed plugin has a **Report issue** action. The main process builds an HTTPS GitHub issue URL from a configured `/issues/new` base and adds only the plugin ID, installed version, and a local-install label when the plugin is absent from the last loaded catalog. It does not include user details, filesystem paths, or plugin logs.

The issue destination is intentionally not hard-coded. Set `AGENT_PETS_PLUGIN_ISSUE_REPORT_URL` in the application launch environment to the HTTPS GitHub issue form URL for the distribution, for example `https://github.com/example/project/issues/new`. If it is unset or invalid, the action displays a localized unavailable message and opens nothing.

The isolated Electron launcher replaces `shell.openExternal` with a recorder. End-to-end checks can inspect `globalThis.__agentPetsE2E.shellOpenExternalCalls` without launching a real browser.
