const PET_URL = 'http://127.0.0.1:17373/v1/events'

async function send(event) {
  try {
    await fetch(PET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(300),
    })
  } catch {}
}

function emit(source, sessionId, state, originalEvent, project, toolName) {
  return send({
    source,
    sessionId: sessionId || 'unknown',
    project,
    state,
    originalEvent,
    timestamp: Date.now(),
    toolName,
  })
}

/** @type {import("@opencode-ai/plugin").Plugin} */
export default async function (input) {
  const project = input.project?.path || input.directory

  return {
    event: async ({ event }) => {
      const e = event.payload
      const sessionID = e.properties?.sessionID

      switch (e.type) {
        case 'session.status':
          return emit('opencode', sessionID, 'thinking', e.type, project)
        case 'session.idle':
          return emit('opencode', sessionID, 'success', e.type, project)
        case 'session.error':
          return emit('opencode', sessionID, 'error', e.type, project)
        case 'permission.asked':
          return emit('opencode', sessionID, 'waiting-permission', e.type, project)
        case 'permission.replied':
          return emit('opencode', sessionID, 'thinking', e.type, project)
      }
    },

    'tool.execute.before': async (input) => {
      return emit('opencode', input.sessionID, 'tool-running', 'tool.execute.before', project, input.tool)
    },

    'tool.execute.after': async (input) => {
      return emit('opencode', input.sessionID, 'thinking', 'tool.execute.after', project, input.tool)
    },

    'permission.ask': async (input) => {
      return emit('opencode', input.sessionID, 'waiting-permission', 'permission.ask', project, input.tool)
    },
  }
}
