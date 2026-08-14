<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  ProjectMcpInstallStatus,
  ProjectMcpProjectRecord,
  ProjectMcpProjectStatus,
  ProjectMcpRemovalStatus,
  ProjectMcpSetupSummary,
} from '@/types/project-mcp'
import { t, translateBackendError, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Icon from '@/components/ui/Icon.vue'

const emit = defineEmits<{
  (event: 'close'): void
}>()

const settingUp = ref(false)
const setupResult = ref<ProjectMcpSetupSummary | null>(null)
const setupError = ref('')
const projects = ref<ProjectMcpProjectRecord[]>([])
const loadingProjects = ref(false)
const listError = ref('')
const removingProject = ref<string | null>(null)

async function refreshProjects(): Promise<void> {
  if (loadingProjects.value) return
  loadingProjects.value = true
  listError.value = ''
  try {
    const result = await window.electronAPI?.listProjectMcp()
    if (!result?.ok) {
      listError.value = translateBackendError(result?.error || t('mcpListFailed'))
      return
    }
    projects.value = result.projects
  } catch {
    listError.value = t('mcpListFailed')
  } finally {
    loadingProjects.value = false
  }
}

async function setupProject(): Promise<void> {
  if (settingUp.value) return
  settingUp.value = true
  setupError.value = ''
  setupResult.value = null
  try {
    const result = await window.electronAPI?.setupProjectMcp()
    if (result && !result.cancelled) {
      setupResult.value = result
      await refreshProjects()
    }
  } catch {
    setupError.value = t('mcpSetupFailed')
  } finally {
    settingUp.value = false
  }
}

const MCP_CLIENT_LABEL_KEYS: Record<string, TranslationKey> = {
  codex: 'clientCodex',
  claude: 'clientClaudeCode',
}

function projectMcpClientLabel(client: string): string {
  return t(MCP_CLIENT_LABEL_KEYS[client] ?? 'clientOpenCode')
}

const INSTALL_STATUS_LABEL_KEYS: Partial<Record<ProjectMcpInstallStatus, TranslationKey>> = {
  installed: 'mcpInstalled',
  already_configured: 'mcpAlreadyConfigured',
  conflict: 'mcpConflictUnchanged',
}

function installStatusLabel(status: ProjectMcpInstallStatus): string {
  return t(INSTALL_STATUS_LABEL_KEYS[status] ?? 'failed')
}

const PROJECT_STATUS_LABEL_KEYS: Partial<Record<ProjectMcpProjectStatus, TranslationKey>> = {
  connected: 'connected',
  partial: 'partial',
  conflict: 'conflict',
  missing: 'folderMissing',
}

function projectStatusLabel(status: ProjectMcpProjectStatus): string {
  return t(PROJECT_STATUS_LABEL_KEYS[status] ?? 'checkFailed')
}

// Drives both the status pill colour and each Card's left accent bar (tone),
// so the same "this connection needs attention" signal reads the same way
// whether you're scanning pills or cards.
const PROJECT_STATUS_TONE: Partial<Record<ProjectMcpProjectStatus, 'success' | 'warn' | 'neutral'>> = {
  connected: 'success',
  partial: 'warn',
  missing: 'warn',
  conflict: 'warn',
  error: 'warn',
}

function projectStatusTone(status: ProjectMcpProjectStatus): 'success' | 'warn' | 'neutral' {
  return PROJECT_STATUS_TONE[status] ?? 'neutral'
}

function removalSummaryLabel(statuses: ProjectMcpRemovalStatus[]): string {
  return statuses.includes('conflict') ? t('mcpEntryChanged') : t('mcpRemoveFailed')
}

// Native confirm() steals focus, which the main process reads as a blur and
// hides the panel mid-confirmation — see components/ui/ConfirmDialog.vue.
const pendingRemoval = ref<ProjectMcpProjectRecord | null>(null)

function requestRemoveProject(project: ProjectMcpProjectRecord): void {
  if (removingProject.value) return
  pendingRemoval.value = project
}

async function confirmRemoveProject(): Promise<void> {
  const project = pendingRemoval.value
  pendingRemoval.value = null
  if (project) await removeProject(project)
}

async function removeProject(project: ProjectMcpProjectRecord): Promise<void> {
  if (removingProject.value) return
  removingProject.value = project.projectPath
  listError.value = ''
  try {
    const result = await window.electronAPI?.removeProjectMcp(project.projectPath)
    if (!result?.ok) {
      listError.value = translateBackendError(
        result?.error || removalSummaryLabel(result?.results.map(item => item.status) ?? []),
      )
    }
    await refreshProjects()
  } catch {
    listError.value = t('mcpRemoveFailed')
  } finally {
    removingProject.value = null
  }
}

async function forgetProject(project: ProjectMcpProjectRecord): Promise<void> {
  if (removingProject.value) return
  removingProject.value = project.projectPath
  listError.value = ''
  try {
    const result = await window.electronAPI?.forgetProjectMcp(project.projectPath)
    if (result && !result.ok) listError.value = translateBackendError(result.error || t('mcpRemoveFailed'))
    await refreshProjects()
  } catch {
    listError.value = t('mcpRemoveFailed')
  } finally {
    removingProject.value = null
  }
}

onMounted(() => {
  void refreshProjects()
})
</script>

<template>
  <div class="mcp-overlay" @click.self="emit('close')">
    <div
      class="mcp-wizard"
      role="dialog"
      aria-modal="true"
      :aria-label="t('projectMcpPanelTitle')"
    >
      <div class="wizard-header">
        <div class="mcp-title-copy">
          <h2>{{ t('projectMcpPanelTitle') }}</h2>
          <p>{{ t('projectMcpPanelHelp') }}</p>
        </div>
        <Button variant="ghost" icon-only :aria-label="t('projectMcpClose')" @click="emit('close')">
          <Icon name="close" />
        </Button>
      </div>

      <div class="mcp-toolbar">
        <Button variant="primary" size="sm" block :disabled="settingUp" @click="setupProject">
          {{ settingUp ? t('installing') : t('setupMcpForProject') }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="loadingProjects" @click="refreshProjects">
          {{ loadingProjects ? t('checking') : t('refresh') }}
        </Button>
      </div>

      <div v-if="setupError" class="error-msg" role="alert">{{ setupError }}</div>

      <Card v-if="setupResult" tone="accent" role="status" aria-live="polite">
        <div class="mcp-result-title">{{ setupResult.projectPath || t('projectMcpNoProject') }}</div>
        <div
          v-for="item in setupResult.results"
          :key="item.client"
          class="mcp-result-row"
          :class="`mcp-${item.status}`"
        >
          <span class="mcp-client">{{ projectMcpClientLabel(item.client) }}</span>
          <span>{{ installStatusLabel(item.status) }}</span>
          <span v-if="item.message" class="mcp-message">{{ translateBackendError(item.message) }}</span>
        </div>
        <div v-if="!setupResult.ok" class="mcp-inline-error">{{ t('resultNeedsAttention') }}</div>
      </Card>

      <div class="mcp-list-heading">
        <div>
          <h3>{{ t('connectedProjects') }}</h3>
          <p>{{ t('connectedProjectsHelp') }}</p>
        </div>
        <span class="mcp-count" aria-live="polite">{{ projects.length }}</span>
      </div>

      <div v-if="listError" class="error-msg mcp-list-error" role="alert">{{ listError }}</div>
      <div v-if="loadingProjects && projects.length === 0" class="mcp-empty">{{ t('checking') }}</div>
      <div v-else-if="projects.length === 0" class="mcp-empty">{{ t('noProjectsConnected') }}</div>
      <div v-else class="tools-list" role="list" :aria-label="t('connectedMcpProjects')">
        <Card
          v-for="project in projects"
          :key="project.projectPath"
          :tone="projectStatusTone(project.status)"
          role="listitem"
        >
          <div class="mcp-project-heading">
            <div class="mcp-project-name">{{ project.projectName }}</div>
            <span class="mcp-project-status" :class="`status-${projectStatusTone(project.status)}`">
              {{ projectStatusLabel(project.status) }}
            </span>
          </div>
          <div class="mcp-project-path" :title="project.projectPath">{{ project.projectPath }}</div>
          <div v-if="project.results.length" class="mcp-client-list">
            <span v-for="item in project.results" :key="item.client" :class="`mcp-${item.status}`">
              {{ projectMcpClientLabel(item.client) }}: {{ installStatusLabel(item.status) }}
            </span>
          </div>
          <div class="mcp-project-actions">
            <Button
              v-if="project.status === 'missing'"
              variant="secondary"
              size="sm"
              :disabled="removingProject === project.projectPath"
              @click="forgetProject(project)"
            >
              {{ t('forgetRecord') }}
            </Button>
            <Button
              v-else
              variant="danger"
              size="sm"
              :disabled="removingProject === project.projectPath"
              @click="requestRemoveProject(project)"
            >
              {{ removingProject === project.projectPath ? t('removing') : t('removeMcp') }}
            </Button>
          </div>
        </Card>
      </div>

      <details class="wizard-note">
        <summary>{{ t('projectMcpSafetyNote') }}</summary>
        <div class="wizard-note-content">{{ t('projectMcpSafetyNote') }}</div>
      </details>

      <div class="wizard-actions">
        <Button variant="secondary" size="sm" block @click="emit('close')">{{ t('projectMcpClose') }}</Button>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingRemoval !== null"
      :title="t('removeMcp')"
      :message="pendingRemoval
        ? `${t('projectMcpRemoveConfirm', { project: pendingRemoval.projectName })}\n\n${t('projectMcpRemoveConfirmDetail')}`
        : ''"
      tone="danger"
      @confirm="confirmRemoveProject"
      @cancel="pendingRemoval = null"
    />
  </div>
</template>

<style scoped src="@/components/ProjectMcpPanel.css"></style>
