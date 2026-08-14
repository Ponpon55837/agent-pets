<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type {
  AdapterRuntimeStatus,
  AgentAdapterId,
  DiagnosticReport,
} from '../types/agent-adapter'
import type { AgentSource } from '../types/agent'
import { locale, t, translateBackendError } from '../i18n'

const emit = defineEmits<{
  (e: 'close'): void
}>()

interface ToolStatus extends AdapterRuntimeStatus {
  verifiedAt?: number
  testError?: string
  diagnosis?: DiagnosticReport
}

const tools = ref<ToolStatus[]>([])

const loading = ref(true)
const error = ref('')
const installing = ref<AgentAdapterId | 'all' | null>(null)
const testing = ref<AgentSource | null>(null)
const diagnosing = ref<AgentAdapterId | null>(null)
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
      tools.value = status.adapters.map(adapter => ({ ...adapter }))
    } else {
      error.value = t('couldNotDetectTools')
    }
  } catch {
    error.value = t('failedToDetectTools')
  }
  loading.value = false
  stopElapsedTimer()
}

async function install(target?: AgentAdapterId) {
  installing.value = target ?? 'all'
  installError.value = ''
  try {
    const targets = target
      ? [target]
      : tools.value.filter(tool => tool.installable).map(tool => tool.id)
    for (const adapterId of targets) {
      const tool = tools.value.find(item => item.id === adapterId)
      if (tool) {
        tool.verifiedAt = undefined
        tool.testError = undefined
      }
      const result = await window.electronAPI?.installAdapter(adapterId)
      if (result && !result.ok) {
        installError.value = translateBackendError(result.error || t('installFailed'))
        break
      }
    }
  } catch {
    installError.value = t('installFailed')
  }
  installing.value = null
  await detectTools()
}

async function testIntegration(tool: ToolStatus) {
  if (!tool.testSource) return
  testing.value = tool.testSource
  tool.testError = undefined
  try {
    const result = await window.electronAPI?.testIntegration(tool.testSource)
    if (result?.ok && result.verifiedAt) {
      tool.verifiedAt = result.verifiedAt
    } else {
      tool.testError = translateBackendError(result?.error || t('liveEventTestFailed'))
    }
  } catch {
    tool.testError = t('liveEventTestFailed')
  }
  testing.value = null
}

async function diagnoseAdapter(tool: ToolStatus) {
  diagnosing.value = tool.id
  tool.testError = undefined
  try {
    const result = await window.electronAPI?.diagnoseAdapter(tool.id)
    if (result?.ok && result.report) {
      tool.diagnosis = result.report
    } else {
      tool.testError = translateBackendError(result?.error || t('diagnosisFailed'))
    }
  } catch {
    tool.testError = t('diagnosisFailed')
  }
  diagnosing.value = null
}

function healthLabel(tool: ToolStatus): string {
  if (tool.health === 'ready') return t('healthReady')
  if (tool.health === 'needs_install') return t('healthNeedsInstall')
  if (tool.health === 'degraded') return t('healthDegraded')
  if (tool.health === 'needs_approval') return t('healthNeedsApproval')
  return t('healthError')
}

function capabilityLabels(tool: ToolStatus): string[] {
  const capabilities = tool.capabilities
  const labels: string[] = []
  if (capabilities.lifecycle) labels.push(t('capabilityLifecycle'))
  if (capabilities.sessions) labels.push(t('capabilitySessions'))
  if (capabilities.projects) labels.push(t('capabilityProjects'))
  if (capabilities.toolActivity) labels.push(t('capabilityToolActivity'))
  if (capabilities.waitingInput) labels.push(t('capabilityInput'))
  if (capabilities.tokenUsage !== 'none') labels.push(`Token: ${capabilities.tokenUsage}`)
  if (capabilities.quota !== 'none') labels.push(`Quota: ${capabilities.quota}`)
  labels.push(`Permission: ${capabilities.permissions}`)
  return labels
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
        <h2>{{ t('setupWizardTitle') }}</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div v-if="loading" class="loading">
        <div class="pixel-loader">
          <span v-for="i in 9" :key="i" class="pixel-cell" :style="{ animationDelay: `${(i % 3) * 0.12}s` }" />
        </div>
        <span>{{ t('detectingTools') }}</span>
        <span class="elapsed">{{ (elapsedMs / 1000).toFixed(1) }}s</span>
      </div>

      <div v-else-if="error" class="error-msg">
        {{ error }}
        <button class="retry-btn" @click="detectTools">{{ t('retry') }}</button>
      </div>

      <div v-else class="tools-list">
        <div
          v-for="tool in tools"
          :key="tool.id"
          class="tool-item"
          :class="{ connected: tool.health === 'ready', detected: tool.health !== 'ready' && tool.health !== 'error' }"
        >
          <div class="tool-status">
            <span class="status-dot" :class="{ green: tool.health === 'ready', yellow: tool.health !== 'ready' && tool.health !== 'error', red: tool.health === 'error' }" />
            <span class="tool-name">{{ tool.displayName }}</span>
            <span class="tool-health">{{ healthLabel(tool) }}</span>
            <div class="tool-actions">
              <button
                class="test-btn"
                v-if="tool.testSource"
                :disabled="!tool.installed || installing !== null || testing !== null || diagnosing !== null"
                :title="t('testReceiverTitle')"
                @click="testIntegration(tool)"
              >
                {{ testing === tool.testSource ? t('testing') : t('test') }}
              </button>
              <button
                class="test-btn"
                :disabled="installing !== null || testing !== null || diagnosing !== null"
                @click="diagnoseAdapter(tool)"
              >
                {{ diagnosing === tool.id ? t('diagnosing') : t('diagnose') }}
              </button>
              <button
                class="install-btn"
                v-if="tool.installable && tool.installTarget"
                :disabled="installing !== null || testing !== null || diagnosing !== null"
                @click="install(tool.id)"
              >
                {{ installing === tool.id ? t('installing') : tool.installed ? t('reinstall') : t('install') }}
              </button>
            </div>
          </div>
          <div class="tool-desc">{{ tool.message }}</div>
          <div class="source-list">
            <span v-for="source in tool.sourceLabels" :key="source" class="source-chip">{{ source }}</span>
          </div>
          <div class="capability-list">
            <span v-for="capability in capabilityLabels(tool)" :key="capability" class="capability-chip">{{ capability }}</span>
          </div>
          <div v-if="tool.verifiedAt" class="test-result passed">
            {{ t('receiverVerifiedAt', { time: new Date(tool.verifiedAt).toLocaleTimeString(locale) }) }}
          </div>
          <div v-else-if="tool.testError" class="test-result failed">{{ tool.testError }}</div>
          <div v-if="tool.diagnosis" class="diagnosis-list">
            <div v-for="check in tool.diagnosis.checks" :key="check.id" class="diagnosis-row" :class="`diagnosis-${check.status}`">
              <span aria-hidden="true">{{ check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '×' }}</span>
              <span>{{ check.message }}</span>
            </div>
          </div>
        </div>
      </div>

      <details class="wizard-note">
        <summary>{{ t('aboutAdapters') }}</summary>
        <div class="wizard-note-content">
          {{ t('adapterNote') }}
        </div>
      </details>

      <div v-if="installError" class="error-msg">{{ installError }}</div>

      <div class="wizard-actions">
        <button class="action-btn" @click="detectTools">{{ t('refresh') }}</button>
        <button class="action-btn primary" :disabled="installing !== null" @click="install()">
          {{ installing === 'all' ? t('installing') : t('installAll') }}
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
  background: var(--surface-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20000;
  backdrop-filter: blur(4px);
}

.setup-wizard {
  width: min(520px, calc(100% - 28px));
  max-height: min(620px, calc(100vh - 28px));
  box-sizing: border-box;
  background: var(--surface-overlay);
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
  font-size: var(--font-lg);
  font-weight: 600;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: var(--font-xl);
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
  font-size: var(--font-sm);
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
  font-size: var(--font-xs);
}

.error-msg {
  color: #ff6b6b;
  text-align: center;
  padding: 12px;
  font-size: var(--font-sm);
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
  font-size: var(--font-xs);
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
  flex-wrap: wrap;
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
  font-size: var(--font-xs);
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
  font-size: var(--font-sm);
  font-weight: 500;
  color: #e0e0e0;
}

.tool-health {
  padding: 2px 6px;
  border-radius: 999px;
  color: #aeb7cc;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: var(--font-xs);
  text-transform: capitalize;
}

.tool-desc {
  font-size: var(--font-xs);
  color: #8f98ab;
  margin-top: 2px;
  margin-left: 12px;
}

.source-list,
.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0 0 12px;
}

.source-chip,
.capability-chip {
  padding: 2px 6px;
  border-radius: 999px;
  font-size: var(--font-xs);
  line-height: 1.2;
}

.source-chip {
  color: #c9d2e7;
  background: rgba(139, 156, 247, 0.1);
  border: 1px solid rgba(139, 156, 247, 0.18);
}

.capability-chip {
  color: #b8d9cc;
  background: rgba(80, 200, 120, 0.08);
  border: 1px solid rgba(80, 200, 120, 0.16);
}

.test-result {
  margin-top: 3px;
  margin-left: 12px;
  font-size: var(--font-xs);
}

.test-result.passed {
  color: #50c878;
}

.test-result.failed {
  color: #ff6b6b;
}

.diagnosis-list {
  display: grid;
  gap: 3px;
  margin: 7px 0 0 12px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.diagnosis-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: var(--font-xs);
  line-height: 1.35;
}

.diagnosis-pass { color: #80d8a0; }
.diagnosis-warn { color: #e4ca7b; }
.diagnosis-fail { color: #ff8989; }

.wizard-note {
  font-size: var(--font-xs);
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
  font-size: var(--font-xs);
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

@media (prefers-reduced-transparency: reduce) {
  .setup-overlay { backdrop-filter: none; }
  .setup-wizard { background: #191923; }
}

@media (prefers-contrast: more) {
  .setup-wizard,
  .tool-item,
  .wizard-note { border-width: 2px; }
  .tool-health,
  .source-chip,
  .capability-chip { border-color: currentColor; }
}
</style>
