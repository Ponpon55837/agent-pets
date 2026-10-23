import type { PluginProtocolAssets } from './plugin-protocol.ts'

export const pluginHostAssets: PluginProtocolAssets = {
  'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src agent-pets://plugin; worker-src agent-pets://plugin; connect-src \'none\'; img-src agent-pets://plugin; style-src agent-pets://plugin; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"></head><body><script type="module" src="agent-pets://plugin/_host/host.js"></script></body></html>',
  'host.js': String.raw`
const workers = new Map()
const bridge = window.agentPetsPluginHost
if (bridge && typeof bridge.onPort === 'function') {
  bridge.onPort((port) => {
    port.start()
    port.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') return
      if (data.type === 'start' && typeof data.pluginId === 'string' && typeof data.entry === 'string') {
        const pluginId = data.pluginId
        if (!/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(pluginId) || workers.has(pluginId)) return
        try {
          const worker = new Worker('agent-pets://plugin/_host/worker-bootstrap.js', { type: 'module', name: pluginId })
          workers.set(pluginId, worker)
          worker.onmessage = ({ data: message }) => {
            if (!message || typeof message !== 'object') return
            if (message.type === 'rpc') port.postMessage({ type: 'rpc', pluginId, request: message.request })
            else if (message.type === 'pong') port.postMessage({ type: 'pong', pluginId, at: message.at })
            else if (message.type === 'ready') port.postMessage({ type: 'worker-ready', pluginId })
            else if (message.type === 'activation-error') {
              workers.delete(pluginId)
              try { worker.terminate() } catch {}
              port.postMessage({ type: 'worker-crash', pluginId })
            }
          }
          worker.onerror = (event) => {
            event.preventDefault()
            workers.delete(pluginId)
            try { worker.terminate() } catch {}
            port.postMessage({ type: 'worker-crash', pluginId })
          }
          worker.onmessageerror = () => {
            workers.delete(pluginId)
            try { worker.terminate() } catch {}
            port.postMessage({ type: 'worker-crash', pluginId })
          }
          worker.postMessage({ type: 'activate', pluginId, entry: data.entry })
          port.postMessage({ type: 'worker-started', pluginId })
        } catch {
          port.postMessage({ type: 'worker-crash', pluginId })
        }
      } else if (data.type === 'ping' && Number.isSafeInteger(data.at)) {
        for (const worker of workers.values()) worker.postMessage({ type: 'ping', at: data.at })
      } else if (data.type === 'terminate' && typeof data.pluginId === 'string') {
        const worker = workers.get(data.pluginId)
        if (worker) {
          workers.delete(data.pluginId)
          worker.terminate()
        }
      } else if (data.type === 'stop' && typeof data.pluginId === 'string') {
        const worker = workers.get(data.pluginId)
        if (worker) {
          workers.delete(data.pluginId)
          worker.postMessage({ type: 'deactivate' })
          setTimeout(() => worker.terminate(), 100)
        }
      } else if (data.type === 'rpc-result' && typeof data.pluginId === 'string') {
        workers.get(data.pluginId)?.postMessage({ type: 'rpc-result', result: data.result })
      }
    }
  })
}
`,
  'worker-bootstrap.js': String.raw`
const scope = self
const postToHost = scope.postMessage.bind(scope)
Object.defineProperty(scope, 'postMessage', {
  value: () => { throw new TypeError('Plugin workers cannot post directly to the host') },
  writable: false,
  configurable: false,
})
let pluginId = null
let pluginModule = null
const pending = new Map()
let sequence = 0
function rpc(method, args) {
  const id = String(++sequence)
  postToHost({ type: 'rpc', request: { id, method, args } })
  return new Promise((resolve) => pending.set(id, resolve))
}
const api = Object.freeze({
  feed: Object.freeze({ notify: (item) => rpc('feed.notify', [item]) }),
  pet: Object.freeze({ react: (reaction, options) => rpc('pet.react', [reaction, options]) }),
  storage: Object.freeze({
    get: (key) => rpc('storage.get', [key]),
    set: (key, value) => rpc('storage.set', [key, value]),
    remove: (key) => rpc('storage.remove', [key]),
  }),
  log: Object.freeze({
    info: (...values) => rpc('log.info', [values]),
    warn: (...values) => rpc('log.warn', [values]),
    error: (...values) => rpc('log.error', [values]),
  }),
})
scope.onmessage = async ({ data }) => {
  if (!data || typeof data !== 'object') return
  if (data.type === 'activate' && pluginId === null) {
    const id = data.pluginId
    const entry = data.entry
    if (typeof id !== 'string' || !/^(?!_host$|_shared$)[a-z0-9-]{3,48}$/.test(id)
      || typeof entry !== 'string' || !/^(?!\/)(?!.*(?:^|\/)\.\.?\/)[^\\:]+\.js$/.test(entry)) return
    pluginId = id
    try {
      pluginModule = await import('agent-pets://plugin/' + id + '/' + entry)
      if (!pluginModule.default || typeof pluginModule.default.activate !== 'function') throw new TypeError('invalid plugin entry')
      await pluginModule.default.activate(api)
      postToHost({ type: 'ready' })
    } catch {
      postToHost({ type: 'activation-error' })
    }
  } else if (data.type === 'ping' && Number.isSafeInteger(data.at)) {
    postToHost({ type: 'pong', at: data.at })
  } else if (data.type === 'rpc-result' && data.result && typeof data.result === 'object') {
    const result = data.result
    const id = result && typeof result.id === 'string' ? result.id : null
    const resolve = id ? pending.get(id) : undefined
    if (resolve) {
      pending.delete(id)
      resolve(result)
    }
  } else if (data.type === 'deactivate' && pluginId !== null) {
    try {
      if (typeof pluginModule?.default?.deactivate === 'function') await pluginModule.default.deactivate()
    } catch {}
    scope.close()
  }
}
`,
}
