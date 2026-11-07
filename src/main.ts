import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@/styles/tokens.css'
import '@/styles/base.css'
import App from '@/App.vue'
import { initTheme } from '@/composables/useTheme'

initTheme()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
