<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type {
  AdapterRuntimeStatus,
  AgentAdapterId,
  DiagnosticReport,
} from '@/types/agent-adapter'
import type { AgentSource } from '@/types/agent'
import { locale, t, translateBackendError, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

const props = defineProps<{
  /** Opened automatically on the first launch: start with the short intro. */
  firstRun?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// intro (what the pet does) -> tools (install hooks). Replays from Settings go straight to tools.
const step = ref<'intro' | 'tools'>(props.firstRun ? 'intro' : 'tools')
const anyReady = computed(() => tools.value.some(tool => tool.installable && tool.health === 'ready'))

const INTRO_CARDS = [
  { icon: 'bell', title: 'onboarding.introStatusTitle', body: 'onboarding.introStatusBody' },
  { icon: 'lock', title: 'onboarding.introPermissionTitle', body: 'onboarding.introPermissionBody' },
  { icon: 'growth', title: 'onboarding.introGrowthTitle', body: 'onboarding.introGrowthBody' },
] as const satisfies ReadonlyArray<{ icon: string, title: TranslationKey, body: TranslationKey }>

// Finishing with at least one connected tool completes onboarding; leaving earlier is remembered as
// a skip so the wizard does not reopen on its own. Replays never downgrade a completed state.
function finish() {
  const action = anyReady.value ? 'completed' : 'skipped'
  if (props.firstRun || anyReady.value) void window.electronAPI?.updateOnboardingState(action)
  emit('close')
}

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
const removing = ref<AgentAdapterId | 'all' | null>(null)
const pendingRemoval = ref<AgentAdapterId | 'all' | null>(null)
const removalNotice = ref('')

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

function requestRemoval(target: AgentAdapterId | 'all') {
  if (installing.value !== null || removing.value !== null) return
  pendingRemoval.value = target
}

// Removal only strips Agent Pets' own entries in main; the confirm text spells out what is kept.
async function confirmRemoval() {
  const target = pendingRemoval.value
  pendingRemoval.value = null
  if (!target) return
  removing.value = target
  installError.value = ''
  removalNotice.value = ''
  try {
    const result = target === 'all'
      ? await window.electronAPI?.uninstallIntegrations('all')
      : await window.electronAPI?.uninstallAdapter(target)
    if (result && !result.ok) {
      installError.value = translateBackendError(result.error || t('onboarding.removeFailed'))
    } else {
      removalNotice.value = t(target === 'all' ? 'onboarding.cleanupDone' : 'onboarding.removeDone')
    }
  } catch {
    installError.value = t('onboarding.removeFailed')
  }
  removing.value = null
  await detectTools()
}

function removalTitle(): string {
  const target = pendingRemoval.value
  if (target === 'all') return t('onboarding.cleanupTitle')
  const tool = tools.value.find(item => item.id === target)
  return t('onboarding.removeTitle', { name: tool?.displayName ?? '' })
}

function removalMessage(): string {
  return pendingRemoval.value === 'all' ? t('onboarding.cleanupBody') : t('onboarding.removeBody')
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
  <div class="setup-overlay" @click.self="finish">
    <div class="setup-wizard">
      <div class="wizard-header">
        <div class="wizard-title-copy">
          <h2>{{ t('setupWizardTitle') }}</h2>
          <p>{{ t('setupWizardHelp') }}</p>
        </div>
        <Button variant="ghost" icon-only :aria-label="t('close')" @click="finish">
          <Icon name="close" />
        </Button>
      </div>

      <div v-if="step === 'intro'" class="intro">
        <Card v-for="card in INTRO_CARDS" :key="card.title" class="intro-card">
          <div class="intro-card-head">
            <Icon :name="card.icon" :size="18" />
            <strong>{{ t(card.title) }}</strong>
          </div>
          <p>{{ t(card.body) }}</p>
        </Card>
        <p class="wizard-note">{{ t('onboarding.introNext') }}</p>
      </div>

      <div v-else-if="loading" class="loading">
        <div class="pixel-loader">
          <span v-for="i in 9" :key="i" class="pixel-cell" :style="{ animationDelay: `${(i % 3) * 0.12}s` }" />
        </div>
        <span>{{ t('detectingTools') }}</span>
        <span class="elapsed">{{ (elapsedMs / 1000).toFixed(1) }}s</span>
      </div>

      <div v-else-if="error" class="error-msg">
        {{ error }}
        <Button variant="secondary" size="sm" @click="detectTools">{{ t('retry') }}</Button>
      </div>

      <div v-else class="tools-list">
        <Card
          v-for="tool in tools"
          :key="tool.id"
          class="tool-item"
          :class="[`health-${tool.health}`, { connected: tool.health === 'ready', detected: tool.health !== 'ready' && tool.health !== 'error' }]"
          :tone="tool.health === 'ready' ? 'success' : tool.health === 'needs_install' ? 'accent' : 'neutral'"
        >
          <div class="tool-status">
            <span class="status-dot" :class="{ green: tool.health === 'ready', yellow: tool.health !== 'ready' && tool.health !== 'error', red: tool.health === 'error' }" />
            <span class="tool-name">{{ tool.displayName }}</span>
            <span class="tool-health">{{ healthLabel(tool) }}</span>
            <div class="tool-actions">
              <Button
                variant="secondary"
                size="sm"
                class="tool-action test-btn"
                v-if="tool.testSource"
                :disabled="!tool.installed || installing !== null || testing !== null || diagnosing !== null"
                :title="t('testReceiverTitle')"
                @click="testIntegration(tool)"
              >
                {{ testing === tool.testSource ? t('testing') : t('test') }}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                class="tool-action test-btn"
                :disabled="installing !== null || testing !== null || diagnosing !== null"
                @click="diagnoseAdapter(tool)"
              >
                {{ diagnosing === tool.id ? t('diagnosing') : t('diagnose') }}
              </Button>
              <Button
                variant="primary"
                size="sm"
                class="tool-action install-action install-btn"
                v-if="tool.installable && tool.installTarget"
                :disabled="installing !== null || testing !== null || diagnosing !== null || removing !== null"
                @click="install(tool.id)"
              >
                {{ installing === tool.id ? t('installing') : tool.installed ? t('reinstall') : t('install') }}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                class="tool-action remove-btn"
                v-if="tool.installable && (tool.installed || tool.health === 'degraded')"
                :disabled="installing !== null || testing !== null || diagnosing !== null || removing !== null"
                @click="requestRemoval(tool.id)"
              >
                {{ removing === tool.id ? t('removing') : t('remove') }}
              </Button>
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
              <Icon
                :name="check.status === 'pass' ? 'check' : check.status === 'warn' ? 'warning' : 'close'"
                :size="14"
              />
              <span>{{ check.message }}</span>
            </div>
          </div>
        </Card>
      </div>

      <template v-if="step === 'intro'">
        <div class="wizard-actions">
          <Button variant="ghost" @click="finish">{{ t('onboarding.skipForNow') }}</Button>
          <Button variant="primary" @click="step = 'tools'">{{ t('onboarding.start') }}</Button>
        </div>
      </template>
      <template v-else>
      <p class="wizard-note">{{ t('adapterNote') }}</p>
  
        <div v-if="installError" class="error-msg" role="alert">{{ installError }}</div>
        <p v-else-if="removalNotice" class="wizard-note" role="status">{{ removalNotice }}</p>
  
        <div class="wizard-actions">
          <Button
            variant="ghost"
            class="cleanup-btn"
            :disabled="installing !== null || removing !== null"
            @click="requestRemoval('all')"
          >
            {{ removing === 'all' ? t('removing') : t('onboarding.cleanupAll') }}
          </Button>
          <Button variant="secondary" @click="detectTools">{{ t('refresh') }}</Button>
          <Button variant="primary" :disabled="installing !== null" @click="install()">
            {{ installing === 'all' ? t('installing') : t('installAll') }}
          </Button>
        </div>
        <p v-if="anyReady" class="wizard-note" role="status">{{ t('onboarding.nextSteps') }}</p>
        <div v-if="anyReady" class="wizard-actions">
          <Button variant="primary" @click="finish">{{ t('onboarding.finish') }}</Button>
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="pendingRemoval !== null"
      :title="removalTitle()"
      :message="removalMessage()"
      tone="danger"
      :confirm-label="t('remove')"
      @confirm="confirmRemoval"
      @cancel="pendingRemoval = null"
    />
  </div>
</template>

<style scoped src="@/components/SetupWizard.css"></style>
