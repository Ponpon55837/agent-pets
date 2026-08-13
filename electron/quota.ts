import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { translateBackendError } from '../src/i18n.ts'

const execFileAsync = promisify(execFile)

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1024 * 1024
// Deliberately shorter than the renderer's poll interval: at equal values a
// scheduled poll lands on a cache entry that is only just about to expire and
// gets served a stale reading, doubling the effective lag. This still
// coalesces the pet and panel windows asking at roughly the same moment.
const CACHE_TTL_MS = 90_000
const FORCE_REFRESH_COOLDOWN_MS = 10_000
const MAX_WINDOWS_PER_PROVIDER = 32
const MAX_DISPLAY_TEXT_LENGTH = 96
const ALLOWED_ENDPOINTS = new Set([
  CODEX_USAGE_URL,
  CODEX_REFRESH_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REFRESH_URL,
])

export interface QuotaWindow {
  id: string
  label: string
  usedPercent: number
  remainingPercent: number
  resetsAt?: string
}

export interface QuotaProvider {
  id: 'codex' | 'claude'
  name: string
  plan?: string
  windows: QuotaWindow[]
  error?: string
}

export interface QuotaUsageResult {
  updatedAt: string
  providers: QuotaProvider[]
}

interface ClaudeCredential {
  root: Record<string, unknown>
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  source: 'environment' | 'keychain' | 'file'
  keychainAccount?: string
  filePath?: string
}

let cachedResult: QuotaUsageResult | null = null
let cachedAt = 0
let inFlight: Promise<QuotaUsageResult> | null = null
let tempSequence = 0
let lastFetchStartedAt = 0

class QuotaDisplayError extends Error {}

function asObject(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finitePercent(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

function cleanPlan(value: unknown): string | undefined {
  const plan = nonEmptyString(value)
  if (!plan) return undefined
  return plan
    .replace(/^chatgpt[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, MAX_DISPLAY_TEXT_LENGTH)
}

function displayString(value: unknown, fallback: string): string {
  return (nonEmptyString(value) || fallback).slice(0, MAX_DISPLAY_TEXT_LENGTH)
}

function safeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'AbortError') return translateBackendError('Request timed out. Try again.')
  if (error instanceof QuotaDisplayError && error.message) return translateBackendError(error.message)
  return translateBackendError(fallback)
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new QuotaDisplayError('The quota service returned an unexpectedly large response.')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new QuotaDisplayError('The quota service returned an unexpectedly large response.')
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, any> }> {
  if (!ALLOWED_ENDPOINTS.has(url) || new URL(url).protocol !== 'https:') {
    throw new QuotaDisplayError('Refused an untrusted quota endpoint.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await readLimitedResponse(response)
    let body: Record<string, any> = {}
    if (text) {
      try {
        body = asObject(JSON.parse(text)) ?? {}
      } catch {
        if (response.ok) throw new QuotaDisplayError('Usage response was not valid JSON.')
      }
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function atomicWriteJson(filePath: string, value: Record<string, unknown>): void {
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.agent-pets-${process.pid}-${tempSequence++}.tmp`,
  )
  const data = `${JSON.stringify(value, null, 2)}\n`
  let wroteTemp = false
  try {
    const descriptor = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
    wroteTemp = true
    try {
      fs.writeFileSync(descriptor, data, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.renameSync(tempPath, filePath)
  } finally {
    if (wroteTemp && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath) } catch {}
    }
  }
}

function codexAuthPath(): string {
  const configuredHome = nonEmptyString(process.env.CODEX_HOME)
  return path.join(configuredHome || path.join(os.homedir(), '.codex'), 'auth.json')
}

function loadCodexCredential(): {
  filePath: string
  root: Record<string, any>
  accessToken: string
  refreshToken?: string
  accountId?: string
} {
  const filePath = codexAuthPath()
  let root: Record<string, any>
  try {
    root = asObject(JSON.parse(fs.readFileSync(filePath, 'utf8'))) ?? {}
  } catch {
    throw new QuotaDisplayError('No existing Codex CLI subscription session was found. Agent Pets never asks for credentials.')
  }
  if (nonEmptyString(root.OPENAI_API_KEY)) {
    throw new QuotaDisplayError('Codex CLI is using API-key mode; subscription quota requires an existing Codex CLI subscription session.')
  }
  const tokens = asObject(root.tokens)
  const accessToken = nonEmptyString(tokens?.access_token ?? tokens?.accessToken)
  if (!tokens || !accessToken) {
    throw new QuotaDisplayError('The existing Codex CLI subscription session is unavailable. Agent Pets never asks for credentials.')
  }
  return {
    filePath,
    root,
    accessToken,
    refreshToken: nonEmptyString(tokens.refresh_token ?? tokens.refreshToken),
    accountId: nonEmptyString(tokens.account_id ?? tokens.accountId),
  }
}

function codexNeedsRefresh(root: Record<string, any>): boolean {
  const lastRefresh = Date.parse(String(root.last_refresh ?? ''))
  return !Number.isFinite(lastRefresh) || Date.now() - lastRefresh > 8 * 24 * 60 * 60_000
}

async function refreshCodexCredential(
  credential: ReturnType<typeof loadCodexCredential>,
): Promise<ReturnType<typeof loadCodexCredential>> {
  if (!credential.refreshToken) return credential
  const { status, body } = await requestJson(CODEX_REFRESH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      scope: 'openid profile email',
    }),
  })
  if (status < 200 || status >= 300) {
    throw new QuotaDisplayError('The existing Codex CLI session expired. Re-authenticate in Codex CLI.')
  }
  const accessToken = nonEmptyString(body.access_token ?? body.accessToken)
  if (!accessToken) throw new QuotaDisplayError('Codex refresh response did not contain an access token.')

  // Do not overwrite a login that changed while the refresh request was in flight.
  const current = loadCodexCredential()
  if (current.accessToken !== credential.accessToken) return current
  const currentTokens = asObject(current.root.tokens) ?? {}
  const nextRoot = {
    ...current.root,
    last_refresh: new Date().toISOString(),
    tokens: {
      ...currentTokens,
      access_token: accessToken,
      refresh_token: nonEmptyString(body.refresh_token ?? body.refreshToken) || credential.refreshToken,
      id_token: nonEmptyString(body.id_token ?? body.idToken) || currentTokens.id_token,
    },
  }
  atomicWriteJson(credential.filePath, nextRoot)
  return loadCodexCredential()
}

function mapCodexWindow(id: string, raw: unknown, fallbackLabel?: string): QuotaWindow | null {
  const window = asObject(raw)
  const used = finitePercent(window?.used_percent)
  if (!window || used === null) return null
  const duration = Number(window.limit_window_seconds)
  const label = displayString(
    fallbackLabel,
    duration === 18_000 ? 'Session' : duration === 604_800 ? 'Weekly' : 'Usage',
  )
  const resetSeconds = Number(window.reset_at)
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: 100 - used,
    ...(Number.isFinite(resetSeconds) && resetSeconds > 0
      ? { resetsAt: new Date(resetSeconds * 1000).toISOString() }
      : {}),
  }
}

export function parseCodexUsage(body: Record<string, any>): Pick<QuotaProvider, 'plan' | 'windows'> {
  const windows: QuotaWindow[] = []
  const rateLimit = asObject(body.rate_limit)
  const mainWindows = [rateLimit?.primary_window, rateLimit?.secondary_window]
    .map((window, index) => mapCodexWindow(`main-${index}`, window))
    .filter((window): window is QuotaWindow => window !== null)
    .sort((a, b) => (a.label === 'Session' ? -1 : b.label === 'Session' ? 1 : 0))
  windows.push(...mainWindows)

  if (Array.isArray(body.additional_rate_limits)) {
    for (let entryIndex = 0; entryIndex < body.additional_rate_limits.length; entryIndex += 1) {
      if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
      const entry: unknown = body.additional_rate_limits[entryIndex]
      const additional = asObject(entry)
      const additionalRate = asObject(additional?.rate_limit)
      const label = displayString(additional?.limit_name ?? additional?.metered_feature, 'Additional')
      for (const [slot, raw] of [
        ['primary', additionalRate?.primary_window],
        ['secondary', additionalRate?.secondary_window],
      ] as const) {
        if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
        const mapped = mapCodexWindow(`additional-${entryIndex}-${slot}`, raw, label)
        if (mapped) windows.push(mapped)
      }
    }
  }
  return { plan: cleanPlan(body.plan_type), windows: windows.slice(0, MAX_WINDOWS_PER_PROVIDER) }
}

async function fetchCodexQuota(): Promise<QuotaProvider> {
  try {
    let credential = loadCodexCredential()
    if (codexNeedsRefresh(credential.root) && credential.refreshToken) {
      credential = await refreshCodexCredential(credential)
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${credential.accessToken}`,
      'user-agent': 'Agent Pets',
    }
    if (credential.accountId) headers['ChatGPT-Account-Id'] = credential.accountId
    const { status, body } = await requestJson(CODEX_USAGE_URL, { headers })
    if (status === 401 || status === 403) {
      throw new QuotaDisplayError('The existing Codex CLI session expired. Re-authenticate in Codex CLI.')
    }
    if (status < 200 || status >= 300) throw new QuotaDisplayError(`Codex usage request failed (${status}).`)
    const parsed = parseCodexUsage(body)
    if (parsed.windows.length === 0) throw new QuotaDisplayError('Codex returned no quota windows.')
    return { id: 'codex', name: 'Codex', ...parsed }
  } catch (error) {
    return { id: 'codex', name: 'Codex', windows: [], error: safeError(error, 'Could not load Codex usage.') }
  }
}

async function findClaudeKeychainAccount(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE,
    ], { timeout: 5_000, maxBuffer: 1024 * 1024 })
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.trimStart().match(/^"acct"[^=]*=(.+)$/)
      const raw = match?.[1]?.trim()
      if (raw && !raw.startsWith('0x')) {
        const account = raw.replace(/^"|"$/g, '')
        if (account && account !== '<NULL>') return account
      }
    }
  } catch {}
  return undefined
}

async function readClaudeKeychain(account?: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const args = ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE]
    if (account) args.push('-a', account)
    args.push('-w')
    const { stdout } = await execFileAsync('/usr/bin/security', args, {
      timeout: 5_000,
      maxBuffer: MAX_RESPONSE_BYTES,
    })
    return nonEmptyString(stdout)
  } catch {
    return undefined
  }
}

function writeClaudeKeychain(account: string, data: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // `security -w <secret>` exposes the credential through process argv.
    // Supplying -w last makes security read it from stdin instead.
    const child = spawn('/usr/bin/security', [
      'add-generic-password', '-U', '-s', CLAUDE_KEYCHAIN_SERVICE,
      '-a', account, '-w',
    ], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new QuotaDisplayError('Claude Keychain update timed out.'))
    }, 10_000)
    child.on('error', () => {
      clearTimeout(timeout)
      reject(new QuotaDisplayError('Claude Keychain could not be updated.'))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new QuotaDisplayError('Claude Keychain could not be updated.'))
    })
    child.stdin.end(`${data}\n`)
  })
}

function parseClaudeCredential(
  raw: string,
  source: ClaudeCredential['source'],
  extras: Pick<ClaudeCredential, 'keychainAccount' | 'filePath'> = {},
): ClaudeCredential {
  const root = asObject(JSON.parse(raw))
  const oauth = asObject(root?.claudeAiOauth)
  const accessToken = nonEmptyString(oauth?.accessToken)
  if (!root || !oauth || !accessToken) throw new QuotaDisplayError('Claude OAuth credentials are unavailable.')
  const expiresAt = Number(oauth.expiresAt)
  return {
    root,
    accessToken,
    refreshToken: nonEmptyString(oauth.refreshToken),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    source,
    ...extras,
  }
}

async function loadClaudeCredential(): Promise<ClaudeCredential> {
  const environmentToken = nonEmptyString(process.env.CLAUDE_CODE_OAUTH_TOKEN)
  if (environmentToken) {
    return { root: {}, accessToken: environmentToken, source: 'environment' }
  }

  if (process.platform === 'darwin') {
    const account = await findClaudeKeychainAccount()
    const raw = await readClaudeKeychain(account)
    if (raw) return parseClaudeCredential(raw, 'keychain', { keychainAccount: account })
  }

  const filePath = path.join(os.homedir(), '.claude', '.credentials.json')
  try {
    return parseClaudeCredential(fs.readFileSync(filePath, 'utf8'), 'file', { filePath })
  } catch {
    throw new QuotaDisplayError('No existing Claude Code subscription session was found. Agent Pets never asks for credentials.')
  }
}

function mergeClaudeRefresh(
  credential: ClaudeCredential,
  currentRoot: Record<string, any>,
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: number,
): Record<string, any> {
  const expectedOauth = asObject(credential.root.claudeAiOauth)
  const currentOauth = asObject(currentRoot.claudeAiOauth)
  if (!expectedOauth || !currentOauth || JSON.stringify(expectedOauth) !== JSON.stringify(currentOauth)) {
    throw new QuotaDisplayError('Claude login changed during refresh; retrying will use the new login.')
  }
  return {
    ...currentRoot,
    claudeAiOauth: {
      ...currentOauth,
      accessToken,
      refreshToken: refreshToken || credential.refreshToken,
      expiresAt,
    },
  }
}

async function persistClaudeCredential(
  credential: ClaudeCredential,
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: number,
): Promise<void> {
  if (credential.source === 'file' && credential.filePath) {
    const currentRoot = asObject(JSON.parse(fs.readFileSync(credential.filePath, 'utf8'))) ?? {}
    atomicWriteJson(
      credential.filePath,
      mergeClaudeRefresh(credential, currentRoot, accessToken, refreshToken, expiresAt),
    )
    return
  }
  if (credential.source === 'keychain' && credential.keychainAccount) {
    const currentAccount = await findClaudeKeychainAccount()
    if (currentAccount !== credential.keychainAccount) {
      throw new QuotaDisplayError('Claude Keychain account changed during refresh.')
    }
    const currentRaw = await readClaudeKeychain(currentAccount)
    if (!currentRaw) throw new QuotaDisplayError('Claude Keychain credentials disappeared during refresh.')
    const currentRoot = asObject(JSON.parse(currentRaw)) ?? {}
    const merged = mergeClaudeRefresh(credential, currentRoot, accessToken, refreshToken, expiresAt)
    await writeClaudeKeychain(currentAccount, JSON.stringify(merged))
  }
}

async function refreshClaudeCredential(credential: ClaudeCredential): Promise<ClaudeCredential> {
  if (!credential.refreshToken || credential.source === 'environment') {
    throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
  }
  const { status, body } = await requestJson(CLAUDE_REFRESH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    }).toString(),
  })
  if (status < 200 || status >= 300) {
    throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
  }
  const accessToken = nonEmptyString(body.access_token)
  if (!accessToken) throw new QuotaDisplayError('Claude refresh response did not contain an access token.')
  const expiresIn = Number(body.expires_in)
  const expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000
  await persistClaudeCredential(
    credential,
    accessToken,
    nonEmptyString(body.refresh_token),
    expiresAt,
  )
  return loadClaudeCredential()
}

function mapClaudeWindow(id: string, label: string, raw: unknown): QuotaWindow | null {
  const window = asObject(raw)
  const used = finitePercent(window?.utilization ?? window?.percent)
  if (!window || used === null) return null
  const resetValue = nonEmptyString(window.resets_at)
  const resetMillis = resetValue ? Date.parse(resetValue) : NaN
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: 100 - used,
    ...(Number.isFinite(resetMillis) ? { resetsAt: new Date(resetMillis).toISOString() } : {}),
  }
}

export function parseClaudeUsage(body: Record<string, any>): QuotaWindow[] {
  const windows: QuotaWindow[] = []
  const definitions: Array<[string, string, string[]]> = [
    ['session', 'Session', ['five_hour']],
    ['weekly', 'Weekly', ['seven_day']],
    ['oauth-apps', 'OAuth Apps', ['seven_day_oauth_apps']],
    ['sonnet', 'Sonnet', ['seven_day_sonnet']],
    ['opus', 'Opus', ['seven_day_opus']],
    ['design', 'Designs', ['seven_day_design', 'seven_day_claude_design', 'claude_design', 'design', 'seven_day_omelette', 'omelette']],
    ['routines', 'Daily Routines', ['seven_day_routines', 'seven_day_claude_routines', 'claude_routines', 'routines', 'routine', 'seven_day_cowork', 'cowork']],
  ]
  for (const [id, label, keys] of definitions) {
    for (const key of keys) {
      const mapped = mapClaudeWindow(id, label, body[key])
      if (mapped) {
        windows.push(mapped)
        break
      }
    }
  }
  if (Array.isArray(body.limits)) {
    const existingLabels = new Set(windows.map((window) => window.label.toLowerCase()))
    for (let index = 0; index < body.limits.length; index += 1) {
      if (windows.length >= MAX_WINDOWS_PER_PROVIDER) break
      const raw: unknown = body.limits[index]
      const limit = asObject(raw)
      if (limit?.group !== 'weekly' || limit?.kind !== 'weekly_scoped') continue
      const scope = asObject(limit?.scope)
      const model = asObject(scope?.model)
      const displayName = nonEmptyString(model?.display_name)?.slice(0, MAX_DISPLAY_TEXT_LENGTH)
      if (!displayName || /(^|[-_ ])all[-_ ]models$/i.test(displayName)) continue
      const label = ['sonnet', 'opus', 'designs', 'daily routines'].includes(displayName.toLowerCase())
        ? displayName
        : `${displayName} only`
      if (existingLabels.has(displayName.toLowerCase()) || existingLabels.has(label.toLowerCase())) continue
      const mapped = mapClaudeWindow(`limit-${index}`, label, limit)
      if (mapped) {
        windows.push(mapped)
        existingLabels.add(label.toLowerCase())
      }
    }
  }
  return windows.slice(0, MAX_WINDOWS_PER_PROVIDER)
}

async function claudeUserAgent(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], { timeout: 3_000 })
    const version = stdout.trim().split(/\s+/)[0]
    if (version) return `claude-code/${version}`
  } catch {}
  return 'claude-code/2.1.0'
}

async function fetchClaudeQuota(): Promise<QuotaProvider> {
  try {
    let credential = await loadClaudeCredential()
    if (credential.expiresAt && credential.expiresAt <= Date.now()) {
      credential = await refreshClaudeCredential(credential)
    }
    const { status, body } = await requestJson(CLAUDE_USAGE_URL, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${credential.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'user-agent': await claudeUserAgent(),
      },
    })
    if (status === 401) throw new QuotaDisplayError('The existing Claude Code session expired. Re-authenticate in Claude Code.')
    if (status === 403) throw new QuotaDisplayError('The existing Claude Code session cannot access quota. Re-authenticate in Claude Code.')
    if (status === 429) throw new QuotaDisplayError('Claude quota is rate limited. Wait a minute and retry.')
    if (status < 200 || status >= 300) throw new QuotaDisplayError(`Claude usage request failed (${status}).`)
    const windows = parseClaudeUsage(body)
    if (windows.length === 0) throw new QuotaDisplayError('Claude returned no quota windows.')
    const oauth = asObject(credential.root.claudeAiOauth)
    return {
      id: 'claude',
      name: 'Claude Code',
      plan: cleanPlan(oauth?.subscriptionType ?? oauth?.rateLimitTier),
      windows,
    }
  } catch (error) {
    return { id: 'claude', name: 'Claude Code', windows: [], error: safeError(error, 'Could not load Claude usage.') }
  }
}

export async function getQuotaUsage(force = false): Promise<QuotaUsageResult> {
  const now = Date.now()
  if (!force && cachedResult && now - cachedAt < CACHE_TTL_MS) return cachedResult
  if (force && cachedResult && now - lastFetchStartedAt < FORCE_REFRESH_COOLDOWN_MS) return cachedResult
  if (inFlight) return inFlight
  lastFetchStartedAt = now
  inFlight = (async () => {
    const providers = await Promise.all([fetchCodexQuota(), fetchClaudeQuota()])
    const result = { updatedAt: new Date().toISOString(), providers }
    cachedResult = result
    cachedAt = Date.now()
    return result
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
