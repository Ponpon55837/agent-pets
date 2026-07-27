<script setup lang="ts">
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  (e: 'close'): void
}>()

interface ToolStatus {
  name: string
  detected: boolean
  connected: boolean
  description: string
}

const tools = ref<ToolStatus[]>([
  { name: 'OpenCode CLI', detected: false, connected: false, description: 'Plugin at ~/.config/opencode/plugins/' },
  { name: 'OpenCode Desktop', detected: false, connected: false, description: 'Plugin in AppData' },
  { name: 'Codex CLI', detected: false, connected: false, description: 'Hooks at ~/.codex/hooks.json' },
  { name: 'Claude Desktop', detected: false, connected: false, description: 'Config at AppData/Claude/' },
])

const loading = ref(true)
const error = ref('')

async function detectTools() {
  loading.value = true
  error.value = ''
  try {
    const status = await Promise.race([
      window.electronAPI?.checkIntegration() ?? Promise.resolve(null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ])
    if (status) {
      tools.value[0].detected = status.opencode.cli
      tools.value[0].connected = status.opencode.cli
      tools.value[1].detected = status.opencode.desktop
      tools.value[1].connected = status.opencode.desktop
      tools.value[2].detected = status.codex.hooks
      tools.value[2].connected = status.codex.enabled && status.codex.configured && status.codex.hookScript
      tools.value[3].detected = status.claude.config
      tools.value[3].connected = status.claude.hookScript
    } else {
      error.value = 'Could not detect tools (timeout)'
    }
  } catch {
    error.value = 'Failed to detect tools'
  }
  loading.value = false
}

onMounted(() => {
  detectTools()
})
</script>

<template>
  <div class="setup-overlay" @click.self="emit('close')">
    <div class="setup-wizard">
      <div class="wizard-header">
        <h2>Setup Wizard</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div v-if="loading" class="loading">
        <div class="spinner" />
        Detecting tools...
      </div>

      <div v-else-if="error" class="error-msg">
        {{ error }}
        <button class="retry-btn" @click="detectTools">Retry</button>
      </div>

      <div v-else class="tools-list">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="tool-item"
          :class="{ connected: tool.connected, detected: tool.detected && !tool.connected }"
        >
          <div class="tool-status">
            <span class="status-dot" :class="{ green: tool.connected, yellow: tool.detected && !tool.connected, red: !tool.detected }" />
            <span class="tool-name">{{ tool.name }}</span>
          </div>
          <div class="tool-desc">{{ tool.description }}</div>
        </div>
      </div>

      <div class="wizard-actions">
        <button class="action-btn" @click="detectTools">Refresh</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20000;
  backdrop-filter: blur(4px);
}

.setup-wizard {
  width: 280px;
  max-height: 360px;
  background: rgba(25, 25, 35, 0.98);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.wizard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.wizard-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.close-btn:hover {
  color: #fff;
}

.loading {
  color: #888;
  text-align: center;
  padding: 16px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #8b9cf7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-msg {
  color: #ff6b6b;
  text-align: center;
  padding: 12px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.retry-btn {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #ccc;
  font-size: 11px;
  cursor: pointer;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-item {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.tool-item.connected {
  border-color: rgba(80, 200, 120, 0.3);
  background: rgba(80, 200, 120, 0.04);
}

.tool-item.detected {
  border-color: rgba(200, 180, 80, 0.3);
  background: rgba(200, 180, 80, 0.04);
}

.tool-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff5555;
}

.status-dot.green {
  background: #50c878;
}

.status-dot.yellow {
  background: #c8b450;
}

.tool-name {
  font-size: 12px;
  font-weight: 500;
  color: #e0e0e0;
}

.tool-desc {
  font-size: 10px;
  color: #555;
  margin-top: 2px;
  margin-left: 12px;
}

.wizard-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  flex: 1;
  padding: 7px 12px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #ccc;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
</style>
