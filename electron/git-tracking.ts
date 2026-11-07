import * as fs from 'node:fs'
import * as path from 'node:path'

// Dependency-free, read-only Git awareness for the project MCP setup. We never spawn git: the
// index is parsed directly and `.git/info/exclude` is the only file ever written.

const MAX_INDEX_BYTES = 64 * 1024 * 1024
const INDEX_FIXED_ENTRY_BYTES = 62

export interface GitLocation {
  /** Directory holding index / info/exclude for this working tree. */
  gitDir: string
  /** Shared directory (differs from gitDir for linked worktrees). */
  commonDir: string
}

export function findGitLocation(projectPath: string): GitLocation | null {
  const dotGit = path.join(projectPath, '.git')
  let stat: fs.Stats
  try { stat = fs.lstatSync(dotGit) } catch { return null }
  if (stat.isSymbolicLink()) return null
  if (stat.isDirectory()) return { gitDir: dotGit, commonDir: dotGit }
  if (!stat.isFile() || stat.size > 4096) return null
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'))
  if (!match) return null
  const gitDir = path.resolve(projectPath, match[1]!)
  if (!fs.existsSync(gitDir)) return null
  let commonDir = gitDir
  try {
    const common = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()
    if (common) commonDir = path.resolve(gitDir, common)
  } catch { /* plain repository */ }
  return { gitDir, commonDir }
}

/** Paths (POSIX separators) recorded in the index, or null if the index is absent/unsupported. */
export function readTrackedPaths(location: GitLocation): Set<string> | null {
  const indexPath = path.join(location.gitDir, 'index')
  let buffer: Buffer
  try {
    const stat = fs.statSync(indexPath)
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return null
    buffer = fs.readFileSync(indexPath)
  } catch {
    return null
  }
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'DIRC') return null
  const version = buffer.readUInt32BE(4)
  // Version 4 prefix-compresses paths; treat it as unknown rather than guessing.
  if (version !== 2 && version !== 3) return null
  const count = buffer.readUInt32BE(8)
  const paths = new Set<string>()
  let offset = 12
  for (let index = 0; index < count; index += 1) {
    if (offset + INDEX_FIXED_ENTRY_BYTES > buffer.length) return null
    const flags = buffer.readUInt16BE(offset + 60)
    const extended = version === 3 && (flags & 0x4000) !== 0
    const nameStart = offset + INDEX_FIXED_ENTRY_BYTES + (extended ? 2 : 0)
    let nameEnd = nameStart
    while (nameEnd < buffer.length && buffer[nameEnd] !== 0) nameEnd += 1
    if (nameEnd >= buffer.length) return null
    paths.add(buffer.toString('utf8', nameStart, nameEnd))
    const entryLength = nameEnd - offset + 1
    offset += Math.ceil(entryLength / 8) * 8
  }
  return paths
}

export function toPosixRelative(projectPath: string, filePath: string): string {
  return path.relative(projectPath, filePath).split(path.sep).join('/')
}

/** Adds patterns to the repository-local exclude file. Returns the patterns that were newly added. */
export function addLocalExcludes(location: GitLocation, patterns: string[]): string[] {
  const excludePath = path.join(location.commonDir, 'info', 'exclude')
  let existing = ''
  try {
    const stat = fs.lstatSync(excludePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing to edit an unsafe .git/info/exclude')
    existing = fs.readFileSync(excludePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const present = new Set(existing.split(/\r?\n/).map(line => line.trim()))
  const added = patterns.filter(pattern => !present.has(pattern) && !present.has(`/${pattern}`))
  if (added.length === 0) return []
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const separator = existing.length > 0 && !existing.endsWith('\n') ? eol : ''
  const header = present.has('# Agent Pets local MCP config (contains local paths)') ? '' : `# Agent Pets local MCP config (contains local paths)${eol}`
  fs.mkdirSync(path.dirname(excludePath), { recursive: true })
  fs.writeFileSync(excludePath, `${existing}${separator}${header}${added.map(pattern => `/${pattern}`).join(eol)}${eol}`, 'utf8')
  return added
}
