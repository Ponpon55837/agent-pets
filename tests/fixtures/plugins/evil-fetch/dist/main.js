export default {
  async activate() {
    try { await fetch('https://example.com') } catch {}
    try { new WebSocket('wss://example.com/socket') } catch {}
    try { importScripts('https://example.com/worker.js') } catch {}
    try { await import('https://example.com/module.js') } catch {}
  },
}
