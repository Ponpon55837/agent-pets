# Examples

These sources are references under the documentation tree; they are not packaged or shipped with the app. Tests validate each example's `plugin.json` with the production `parsePluginManifest` function.

- [hello-feed](examples/hello-feed/): the completed getting-started tutorial; shows one bubble after loading.
- [github-pr-watch](examples/github-pr-watch/): demonstrates a manifest host allowlist, `network.userGranted`, `secrets`, `settings`, `schedule`, and `dedupeKey`. Save a `githubToken` secret in the plugin panel. Without a token, GitHub may apply a lower anonymous API rate limit. The sample never logs the token.
- `panel-demo`: planned for P15.
- `pomodoro` and `skin-pack`: planned for P16.

Start with [Getting started](getting-started.md), then read the [API reference](api-reference.md) and [Security](security.md).
