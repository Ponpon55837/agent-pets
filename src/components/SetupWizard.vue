<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type {
  AdapterRuntimeStatus,
  AgentAdapterId,
  DiagnosticReport,
} from '@/types/agent-adapter'
import type { AgentSource } from '@/types/agent'
import { locale, t, translateBackendError, type TranslationKey } from '@/i18n'

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

const HEALTH_LABEL_KEYS: Partial<Record<ToolStatus['health'], TranslationKey>> = {
  ready: 'healthReady',
  needs_install: 'healthNeedsInstall',
  degraded: 'healthDegraded',
  needs_approval: 'healthNeedsApproval',
}

function healthLabel(tool: ToolStatus): string {
  return t(HEALTH_LABEL_KEYS[tool.health] ?? 'healthError')
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

<style scoped src="@/components/SetupWizard.css"></style>
