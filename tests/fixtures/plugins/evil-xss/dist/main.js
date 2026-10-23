export default {
  async activate(api) {
    await api.feed.notify({
      title: '<img src=x onerror=alert(1)>',
      body: '<svg onload=alert(1)>unsafe markup</svg>',
    })
  },
}
