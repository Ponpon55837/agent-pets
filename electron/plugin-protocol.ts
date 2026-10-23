import * as fs from 'node:fs'
import * as path from 'node:path'

export const PLUGIN_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src agent-pets://plugin; worker-src agent-pets://plugin; connect-src 'none'; img-src agent-pets://plugin; style-src agent-pets://plugin; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export const PLUGIN_PROTOCOL_MAX_FILE_BYTES = 5 * 1024 * 1024

export interface PluginProtocolAssets {
  'index.html': string
  'host.js': string
  'worker-bootstrap.js': string
}

export interface PluginProtocolOptions {
  pluginRootForId: (pluginId: string) => string | null
  hostAssets: PluginProtocolAssets
}

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function readRegularFileWithin(root: string, relativePath: string): Buffer | null {
  if (!path.isAbsolute(root) || typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.length > 512 || relativePath.includes('\\')) return null
  const segments = relativePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null

  let descriptor: number | null = null
  try {
    const rootStat = fs.lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null
    const rootReal = fs.realpathSync(root)
    const candidate = path.resolve(root, ...segments)
    if (!isPathInside(root, candidate)) return null
    const candidateStat = fs.lstatSync(candidate)
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size > PLUGIN_PROTOCOL_MAX_FILE_BYTES) return null
    const candidateReal = fs.realpathSync(candidate)
    if (!isPathInside(rootReal, candidateReal)) return null
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    descriptor = fs.openSync(candidateReal, fs.constants.O_RDONLY | noFollow)
    const openedStat = fs.fstatSync(descriptor)
    if (!openedStat.isFile() || openedStat.size > PLUGIN_PROTOCOL_MAX_FILE_BYTES) return null
    return fs.readFileSync(descriptor)
  } catch {
    return null
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function contentType(relativePath: string): string {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}

function pluginResponse(relativePath: string, bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      'content-type': contentType(relativePath),
      'x-content-type-options': 'nosniff',
      'content-security-policy': PLUGIN_CONTENT_SECURITY_POLICY,
    },
  })
}

/** Serves only embedded host resources and explicitly supplied current-version plugin roots. */
export function handlePluginProtocolRequest(requestUrl: string, options: PluginProtocolOptions): Response {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin' || url.username || url.password || url.port
      || url.search || url.hash || url.pathname.includes('%')) return new Response('Not found', { status: 404 })
    const pathname = decodeURIComponent(url.pathname)
    const match = pathname.match(/^\/([^/]+)\/(.+)$/)
    if (!match) return new Response('Not found', { status: 404 })
    const id = match[1] ?? ''
    const relativePath = match[2] ?? ''
    if (id === '_host') {
      if (!Object.hasOwn(options.hostAssets, relativePath)) return new Response('Not found', { status: 404 })
      const source = options.hostAssets[relativePath as keyof PluginProtocolAssets]
      return pluginResponse(relativePath, new TextEncoder().encode(source))
    }
    if (!PLUGIN_ID.test(id)) return new Response('Not found', { status: 404 })
    const root = options.pluginRootForId(id)
    if (!root) return new Response('Not found', { status: 404 })
    const data = readRegularFileWithin(root, relativePath)
    if (!data) return new Response('Not found', { status: 404 })
    return pluginResponse(relativePath, data)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
