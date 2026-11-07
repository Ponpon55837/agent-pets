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

/** Display/network-flag helper only (never used for risk): the tool name with any `mcp__server__` / `server:` / `ns.` prefix removed. */
export function toolBaseName(permission: string): string {
  const segments = permission
    .toLowerCase()
    .trim()
    .split(/__|[:./\\\s]+/)
    .filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1]! : ''
}

export function classifyPermissionRisk(permission: string): PermissionRisk {
  // Exact match on the whole (trimmed, lower-cased) name. No prefix stripping:
  // `mcp__x__read`, `foo:list`, `x/read` or `rm -rf x list` are never `low`.
  const name = typeof permission === 'string' ? permission.trim().toLowerCase() : ''
  if (READ_ONLY_TOOLS.has(name)) return 'low'
  return 'high'
}

export function isNetworkPermission(permission: string): boolean {
  return NETWORK_TOOLS.has(toolBaseName(permission))
}

// Claude Code reports its own tool names (PascalCase). File edits stay inside
// the project and are reviewable afterwards, so they are `medium`; a shell
// command can do anything, so it is `high`. MCP tools and any tool this table
// does not know are `unknown`, which (like `high`) is never hotkey-approvable.
const CLAUDE_TOOL_RISK: Readonly<Record<string, PermissionRisk>> = Object.freeze({
  Bash: 'high',
  Write: 'medium',
  Edit: 'medium',
  MultiEdit: 'medium',
  NotebookEdit: 'medium',
  WebFetch: 'high',
  WebSearch: 'high',
})

const CLAUDE_NETWORK_TOOLS: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch'])

export function classifyClaudeToolRisk(toolName: string): PermissionRisk {
  if (typeof toolName !== 'string') return 'unknown'
  return Object.hasOwn(CLAUDE_TOOL_RISK, toolName) ? CLAUDE_TOOL_RISK[toolName]! : 'unknown'
}

export function isClaudeNetworkTool(toolName: string): boolean {
  return CLAUDE_NETWORK_TOOLS.has(toolName)
}
