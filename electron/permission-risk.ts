import type { PermissionRisk } from '../src/types/permission'

// Fail-closed risk classification for tool names reported by an adapter.
//
// Only tools on an explicit read-only allowlist are `low`. Anything the table
// does not know — renamed tools, new tools, MCP-wrapped tools — is `high`, so
// a tool that merely *sounds* harmless (or hides a dangerous word inside a
// longer name) can never be approved with the global hotkey by accident.
// `unknown` is reserved for requests whose adapter supplied no classification.

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read', 'glob', 'grep', 'list'])

// Tools that reach outside the machine. They stay high-risk (no hotkey) and
// are additionally flagged so the UI can say "connects to the network".
const NETWORK_TOOLS: ReadonlySet<string> = new Set([
  'webfetch',
  'websearch',
  'web_fetch',
  'web_search',
  'fetch',
  'external_directory',
])

/** The tool name with any `mcp__server__` / `server:` / `ns.` prefix removed. */
export function toolBaseName(permission: string): string {
  const segments = permission
    .toLowerCase()
    .trim()
    .split(/__|[:./\\\s]+/)
    .filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1]! : ''
}

export function classifyPermissionRisk(permission: string): PermissionRisk {
  const base = toolBaseName(permission)
  if (READ_ONLY_TOOLS.has(base)) return 'low'
  return 'high'
}

export function isNetworkPermission(permission: string): boolean {
  return NETWORK_TOOLS.has(toolBaseName(permission))
}
