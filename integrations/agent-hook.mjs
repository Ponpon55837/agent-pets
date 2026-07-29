#!/usr/bin/env node

const PET_URL = 'http://127.0.0.1:17373/v1/events'

const validSources = ['codex', 'codex-desktop', 'claude', 'claude-desktop']
const source = validSources.includes(process.argv[2]) ? process.argv[2] : 'codex'


function mapCodexEvent(eventName) {
  switch (eventName) {
    case 'SessionStart':
      return 'idle'
    case 'UserPromptSubmit':
      return 'thinking'
    case 'PreToolUse':
      return 'tool-running'
    case 'PermissionRequest':
      return 'waiting-permission'
    case 'PostToolUse':
      return 'thinking'
    case 'Stop':
      return 'success'
    case 'SessionEnd':
      return 'offline'
    default:
      return null
  }
}

function mapClaudeEvent(eventName, payload) {
  switch (eventName) {
    case 'SessionStart':
      return 'idle'
    case 'UserPromptSubmit':
      return 'thinking'
    case 'PreToolUse':
      return 'tool-running'
    case 'PermissionRequest':
      return 'waiting-permission'
    case 'Notification': {
      // Claude Code's Notification hook sends a human-readable `message`
      // string, not a structured type — match on its content.
      const message = String(payload?.message || '').toLowerCase()
      if (message.includes('permission')) return 'waiting-permission'
      if (message.includes('waiting') || message.includes('idle')) return 'waiting-input'
      return null
    }
    case 'PostToolUse':
      return 'thinking'
    case 'Stop':
      return 'success'
    case 'StopFailure':
      return 'error'
    case 'SessionEnd':
      return 'offline'
    default:
      return null
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data)
    })
  })
}

async function main() {
  const raw = await readStdin()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const eventName = payload?.event || payload?.hook_event_name || ''
  let state = null

  if (source.startsWith('codex')) {
    state = mapCodexEvent(eventName)
  } else if (source.startsWith('claude')) {
    state = mapClaudeEvent(eventName, payload)
  }

  if (!state) {
    process.exit(0)
  }

  const sessionId = payload?.session_id || payload?.sessionId || 'unknown'
  const project = payload?.cwd || payload?.project || undefined
  const toolName = payload?.tool_name || payload?.toolName || undefined

  const event = {
    source,
    sessionId,
    project,
    state,
    originalEvent: eventName,
    timestamp: Date.now(),
    toolName,
  }

  try {
    await fetch(PET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(300),
    })
  } catch {
    // Desktop pet not running, ignore
  }
}

main()
