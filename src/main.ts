import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@/styles/tokens.css'
import '@/styles/base.css'
import App from '@/App.vue'
import { initTheme } from '@/composables/useTheme'

initTheme()
if (import.meta.env.MODE === 'gpu-safe') document.documentElement.dataset.gpuSafe = ''

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
