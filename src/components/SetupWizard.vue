<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{
  (e: 'close'): void
}>()

type IntegrationTarget = 'opencode' | 'codex' | 'claude' | 'claudeCode'
type IntegrationTestSource = 'opencode-cli' | 'opencode-desktop' | 'codex' | 'claude' | 'claude-desktop'

interface ToolStatus {
  name: string
  detected: boolean
  connected: boolean
  description: string
  target: IntegrationTarget
  source: IntegrationTestSource
  verifiedAt?: number
  testError?: string
}

const tools = ref<ToolStatus[]>([
  { name: 'OpenCode CLI', detected: false, connected: false, description: 'Plugin at ~/.config/opencode/plugin/', target: 'opencode', source: 'opencode-cli' },
  { name: 'OpenCode Desktop', detected: false, connected: false, description: 'Plugin in AppData', target: 'opencode', source: 'opencode-desktop' },
  { name: 'Codex CLI', detected: false, connected: false, description: 'Hooks at ~/.codex/hooks.json', target: 'codex', source: 'codex' },
  { name: 'Claude Code CLI', detected: false, connected: false, description: 'Hooks at ~/.claude/settings.json', target: 'claudeCode', source: 'claude' },
  { name: 'Claude Code Desktop', detected: false, connected: false, description: 'Hooks at ~/.claude/settings.json', target: 'claudeCode', source: 'claude-desktop' },
])

const loading = ref(true)
const error = ref('')
const installing = ref<IntegrationTarget | 'all' | null>(null)
const testing = ref<IntegrationTestSource | null>(null)
const installError = ref('')

const elapsedMs = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function startElapsedTimer() {
  const start = Date.now()
  elapsedMs.value = 0
  elapsedTimer = setInterval(() => { elapsedMs.value = Date.now() - start }, 100)
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

async function detectTools() {
  loading.value = true
  error.value = ''
  startElapsedTimer()
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
      tools.value[3].detected = status.claudeCode.settings
      tools.value[3].connected = status.claudeCode.configured && status.claudeCode.hookScript
      tools.value[4].detected = status.claudeCode.settings
      tools.value[4].connected = status.claudeCode.configured && status.claudeCode.hookScript
      for (const tool of tools.value) {
        if (!tool.connected) tool.verifiedAt = undefined
      }
    } else {
      error.value = 'Could not detect tools (timeout)'
    }
  } catch {
    error.value = 'Failed to detect tools'
  }
  loading.value = false
  stopElapsedTimer()
}

async function install(target?: IntegrationTarget) {
  installing.value = target ?? 'all'
  installError.value = ''
  for (const tool of tools.value) {
    if (!target || tool.target === target) {
      tool.verifiedAt = undefined
      tool.testError = undefined
    }
  }
  try {
    const result = await window.electronAPI?.installIntegrations(target)
    if (result && !result.ok) {
      installError.value = result.error || 'Install failed'
    }
  } catch {
    installError.value = 'Install failed'
  }
  installing.value = null
  await detectTools()
}

async function testIntegration(tool: ToolStatus) {
  testing.value = tool.source
  tool.testError = undefined
  try {
    const result = await window.electronAPI?.testIntegration(tool.source)
    if (result?.ok && result.verifiedAt) {
      tool.verifiedAt = result.verifiedAt
    } else {
      tool.testError = result?.error || 'Live event test failed'
    }
  } catch {
    tool.testError = 'Live event test failed'
  }
  testing.value = null
}

onMounted(() => {
  detectTools()
})

onUnmounted(() => {
  stopElapsedTimer()
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
        <div class="pixel-loader">
          <span v-for="i in 9" :key="i" class="pixel-cell" :style="{ animationDelay: `${(i % 3) * 0.12}s` }" />
        </div>
        <span>Detecting tools…</span>
        <span class="elapsed">{{ (elapsedMs / 1000).toFixed(1) }}s</span>
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
            <div class="tool-actions">
              <button
                class="test-btn"
                :disabled="!tool.connected || installing !== null || testing !== null"
                title="Send a live event through the local receiver"
                @click="testIntegration(tool)"
              >
                {{ testing === tool.source ? 'Testing...' : 'Test' }}
              </button>
              <button
                class="install-btn"
                :disabled="installing !== null || testing !== null"
                @click="install(tool.target)"
              >
                {{ installing === tool.target ? '...' : tool.connected ? 'Reinstall' : 'Install' }}
              </button>
            </div>
          </div>
          <div class="tool-desc">{{ tool.description }}</div>
          <div v-if="tool.verifiedAt" class="test-result passed">
            Receiver verified at {{ new Date(tool.verifiedAt).toLocaleTimeString() }}
          </div>
          <div v-else-if="tool.testError" class="test-result failed">{{ tool.testError }}</div>
        </div>
      </div>

      <details class="wizard-note">
        <summary>About testing and Codex Desktop</summary>
        <div class="wizard-note-content">
          Green means the integration files are configured. <strong>Test</strong>
          verifies this running Agent Pets instance can receive and display a live
          local event; it does not launch the coding tool itself.
          Codex Desktop currently has no separate hook API; the Codex entry installs
          the shared CLI hook.
        </div>
      </details>

      <div v-if="installError" class="error-msg">{{ installError }}</div>

      <div class="wizard-actions">
        <button class="action-btn" @click="detectTools">Refresh</button>
        <button class="action-btn primary" :disabled="installing !== null" @click="install()">
          {{ installing === 'all' ? 'Installing...' : 'Install All' }}
        </button>
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
  max-height: 400px;
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

.pixel-loader {
  display: grid;
  grid-template-columns: repeat(3, 4px);
  grid-template-rows: repeat(3, 4px);
  gap: 2px;
}

.pixel-cell {
  width: 4px;
  height: 4px;
  background: #8b9cf7;
  border-radius: 1px;
  animation: pixel-shimmer 1.05s ease-in-out infinite;
}

@keyframes pixel-shimmer {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}

.elapsed {
  font-variant-numeric: tabular-nums;
  color: #555;
  font-size: 10px;
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
  overflow-y: auto;
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

.tool-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.install-btn,
.test-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #ccc;
  font-size: 10px;
  cursor: pointer;
}

.install-btn:hover:not(:disabled),
.test-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.install-btn:disabled,
.test-btn:disabled {
  opacity: 0.5;
  cursor: default;
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

.test-result {
  margin-top: 3px;
  margin-left: 12px;
  font-size: 10px;
}

.test-result.passed {
  color: #50c878;
}

.test-result.failed {
  color: #ff6b6b;
}

.wizard-note {
  font-size: 10px;
  line-height: 1.4;
  color: #888;
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(255, 200, 100, 0.06);
  border: 1px solid rgba(255, 200, 100, 0.12);
}

.wizard-note summary {
  cursor: pointer;
  color: #aaa;
  user-select: none;
}

.wizard-note-content {
  margin-top: 5px;
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

.action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.action-btn.primary {
  background: rgba(139, 156, 247, 0.15);
  border-color: rgba(139, 156, 247, 0.4);
  color: #cdd4ff;
}

.action-btn.primary:hover:not(:disabled) {
  background: rgba(139, 156, 247, 0.25);
}
</style>
