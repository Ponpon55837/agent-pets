void api.agent.emit({ sessionId: 'fixture-build-1', state: 'thinking' })
  .then(() => api.agent.emit({ sessionId: 'fixture-build-1', state: 'tool-running' }))
  .then(() => api.log.info('eventSource status accepted'))
  .catch(error => api.log.info({ code: error?.code ?? 'unknown' }))
