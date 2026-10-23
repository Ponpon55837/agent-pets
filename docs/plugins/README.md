# Agent Pets plugin development

Plugins run in an isolated background Worker and can optionally add a sandboxed page to the settings panel. They can show feed notifications, request pet reactions, read authorized Agent status, and use the controlled network, secrets, settings, schedule, and private storage APIs. Plugins do not receive Node.js, arbitrary network access, or another plugin's data. The Host API major version is `apiVersion: "1"`.

## Guides

- [Getting started in 10 minutes](getting-started.md)
- [Manifest fields](manifest.md)
- [Permissions and consent](permissions.md)
- [Host API reference](api-reference.md)
- [Contribution points](contribution-points.md)
- [Sandbox](sandbox.md)
- [Resource and rate limits](limits.md)
- [Notifications](notifications.md)
- [Debugging](debugging.md)
- [Packaging and versioning](packaging-and-versioning.md)
- [Security](security.md)
- [Panel views](panel-view.md)
- [Examples](examples.md)
- [Manifest JSON Schema](plugin.schema.json)
- [TypeScript Host API](agent-pets-plugin.d.ts)

Examples under `examples/` are author references only. They are not packaged or shipped with the app.
