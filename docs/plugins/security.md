# Security

Treat every plugin as untrusted code. Request only the hosts, secrets, and API permissions you need, and process the minimum user data necessary.

- Never put credentials in source, `plugin.json`, logs, notifications, error messages, or sample packages. Ask the user to save credentials in the plugin panel, then read them with `api.secrets.get`. Secrets are encrypted with the operating system's secure storage; ordinary settings never include secret values.
- Do not log Authorization headers, API tokens, or private user data. Logs remain in the local diagnostics panel.
- Network access must use `api.net.fetch`. Direct Web API connections are unavailable. Every redirect rechecks HTTPS, the granted host, and public DNS. `requestHost` requires user consent; dynamic grants can be revoked in the panel.
- A plugin cannot read another plugin's storage, secrets, or runtime state. Users can disable plugins, revoke dynamic hosts, or remove a plugin; removal deletes its secrets.
- Manifest permission changes require renewed consent. Developer mode is off by default. While it is on, only folders explicitly selected by the user are loaded, and changes are revalidated. Do not load an untrusted development folder.

The sandbox does not make plugin code trustworthy. Report error codes without exposing local paths or credentials.
