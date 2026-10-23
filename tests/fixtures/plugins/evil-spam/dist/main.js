export default {
  async activate(api) {
    for (let index = 0; index < 100; index += 1) {
      await api.feed.notify({ title: `Spam ${index}`, body: 'Repeated test notification.' })
    }
  },
}
