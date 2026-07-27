const PET_URL = 'http://127.0.0.1:17373/v1/events'

interface PluginEvent {
  type: string
  session?: {
    id: string
    project?: string
  }
  tool?: {
    name: string
  }
}

function mapEvent(event: PluginEvent): string | null {
  switch (event.type) {
    case 'session.status':
      return 'thinking'
    case 'session.idle':
      return 'success'
    case 'session.error':
      return 'error'
    case 'permission.asked':
      return 'waiting-permission'
    case 'tool.execute.before':
      return 'tool-running'
    case 'tool.execute.after':
      return 'thinking'
    default:
      return null
  }
}

export default function opencodePlugin(context: any) {
  context.on('event', async (event: PluginEvent) => {
    const state = mapEvent(event)
    if (!state) return

    const sessionId = event.session?.id || 'unknown'
    const project = event.session?.project

    const payload = {
      source: 'opencode',
      sessionId,
      project,
      state,
      originalEvent: event.type,
      timestamp: Date.now(),
      toolName: event.tool?.name,
    }

    try {
      await fetch(PET_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300),
      })
    } catch {
      // Desktop pet not running, ignore
    }
  })
}
