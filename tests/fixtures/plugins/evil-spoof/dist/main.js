export default {
  async activate(api) {
    try {
      self.postMessage({
        pluginId: 'ok-notify',
        id: 'spoof-1',
        method: 'pet.react',
        args: ['jump'],
      })
    } catch {}
    try { await api.pet.react('jump') } catch {}
  },
}
