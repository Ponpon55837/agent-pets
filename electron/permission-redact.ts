// Redaction for text that originates from an agent and is shown in UI or
// notifications. Permission details can contain tool arguments (shell commands,
// URLs, file paths), so credentials and the user's home directory are masked
// before the text ever reaches a renderer.

const REDACTED = '[redacted]'

// Ordered: the specific token shapes run before the generic key=value rule.
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
]

// name=value / name: value / --name value for credential-like names.
const KEY_VALUE_PATTERN =
  /((?:--?)?[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|auth|credential)[A-Za-z0-9_.-]*\s*[=:]\s*|--(?:password|token|secret|api-key)\s+)("[^"]*"|'[^']*'|\S+)/gi

// user:password@host inside URLs.
const URL_CREDENTIALS_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi

const HOME_PATTERNS: ReadonlyArray<RegExp> = [
  /\/Users\/[^/\s'"]+/g,
  /\/home\/[^/\s'"]+/g,
  /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"]+/g,
]

/** Masks credentials and replaces the home directory prefix with `~`. */
export function redactSensitiveText(value: string): string {
  let result = value
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, scheme: unknown) => (
      typeof scheme === 'string' && /^(bearer|basic)$/i.test(scheme) ? `${scheme} ${REDACTED}` : REDACTED
    ))
  }
  result = result.replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`)
  result = result.replace(KEY_VALUE_PATTERN, `$1${REDACTED}`)
  for (const pattern of HOME_PATTERNS) result = result.replace(pattern, '~')
  return result
}
