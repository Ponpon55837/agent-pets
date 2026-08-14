<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  ProjectMcpInstallStatus,
  ProjectMcpProjectRecord,
  ProjectMcpProjectStatus,
  ProjectMcpRemovalStatus,
  ProjectMcpSetupSummary,
} from '../types/project-mcp'
import { t, translateBackendError } from '../i18n'
import Button from './ui/Button.vue'
import Card from './ui/Card.vue'
import ConfirmDialog from './ui/ConfirmDialog.vue'
import Icon from './ui/Icon.vue'

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

function projectMcpClientLabel(client: string): string {
  if (client === 'codex') return t('clientCodex')
  if (client === 'claude') return t('clientClaudeCode')
  return t('clientOpenCode')
}

function installStatusLabel(status: ProjectMcpInstallStatus): string {
  if (status === 'installed') return t('mcpInstalled')
  if (status === 'already_configured') return t('mcpAlreadyConfigured')
  if (status === 'conflict') return t('mcpConflictUnchanged')
  return t('failed')
}

function projectStatusLabel(status: ProjectMcpProjectStatus): string {
  if (status === 'connected') return t('connected')
  if (status === 'partial') return t('partial')
  if (status === 'conflict') return t('conflict')
  if (status === 'missing') return t('folderMissing')
  return t('checkFailed')
}

// Drives both the status pill colour and each Card's left accent bar (tone),
// so the same "this connection needs attention" signal reads the same way
// whether you're scanning pills or cards.
function projectStatusTone(status: ProjectMcpProjectStatus): 'success' | 'warn' | 'neutral' {
  if (status === 'connected') return 'success'
  if (status === 'partial' || status === 'missing') return 'warn'
  if (status === 'conflict' || status === 'error') return 'warn'
  return 'neutral'
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

<style scoped>
/* Everything here reads from src/styles/tokens.css — see
   .agents/skills/pet-skill/references/ui-design-system.md. This panel used
   to hardcode its own colour set (#ccc, #e0e0e0, #cdd4ff, #ff9eae, ...)
   independent of the rest of the app, which is why it looked like a
   different product bolted onto the pet panel. */

.mcp-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-scrim);
  backdrop-filter: blur(4px);
}

.mcp-wizard {
  box-sizing: border-box;
  display: flex;
  width: min(640px, calc(100% - 28px));
  max-height: min(720px, calc(100vh - 28px));
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  overflow: hidden;
  background: var(--surface-overlay);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
}

.wizard-header,
.mcp-project-heading,
.mcp-project-actions,
.mcp-toolbar,
.mcp-list-heading {
  display: flex;
  align-items: center;
}

.wizard-header,
.mcp-project-heading,
.mcp-list-heading {
  justify-content: space-between;
}

.mcp-title-copy {
  min-width: 0;
}

.wizard-header h2,
.mcp-list-heading h3,
.mcp-list-heading p {
  margin: 0;
}

.wizard-header h2 {
  color: var(--text-primary);
  font-size: var(--font-lg);
  font-weight: var(--weight-medium);
}

.mcp-title-copy p,
.mcp-list-heading p {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.mcp-list-heading h3 {
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
}

.mcp-toolbar {
  gap: var(--space-2);
}

.mcp-toolbar > :first-child {
  flex: 1;
}

.mcp-result-title,
.mcp-project-path {
  overflow: hidden;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-result-row {
  display: grid;
  align-items: baseline;
  gap: var(--space-1);
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.mcp-client,
.mcp-project-name {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-message {
  grid-column: 2;
  color: var(--text-muted);
  line-height: 1.35;
}

.mcp-inline-error,
.mcp-list-error {
  color: var(--state-error-soft);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.mcp-list-heading {
  gap: var(--space-2);
}

.mcp-count {
  display: grid;
  min-width: 24px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0 var(--space-1);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-bright);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.tools-list {
  display: flex;
  min-height: 80px;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
}

.mcp-project-heading {
  gap: var(--space-2);
}

.mcp-project-name {
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-project-status {
  flex: 0 0 auto;
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}

.mcp-project-status.status-success,
.mcp-installed,
.mcp-already_configured {
  color: var(--state-success);
}

.mcp-project-status.status-warn,
.mcp-conflict,
.mcp-error {
  color: var(--state-warn-bright);
}

.mcp-project-status.status-neutral {
  color: var(--text-muted);
}

.mcp-project-path {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.mcp-client-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px var(--space-2);
  margin-top: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.mcp-project-actions {
  justify-content: flex-end;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.mcp-empty {
  padding: var(--space-3);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: var(--font-xs);
  text-align: center;
}

.error-msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  color: var(--state-error-soft);
  font-size: var(--font-xs);
  text-align: center;
}

.wizard-note {
  padding: 5px var(--space-2);
  border: 1px solid color-mix(in srgb, var(--state-warn-bright) 22%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--state-warn-bright) 7%, transparent);
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: 1.4;
}

.wizard-note summary {
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.wizard-note-content {
  margin-top: var(--space-1);
}

.wizard-actions {
  display: flex;
  gap: var(--space-2);
}

@media (prefers-reduced-transparency: reduce) {
  .mcp-overlay { backdrop-filter: none; }
  .mcp-wizard { background: var(--surface-overlay); }
}

@media (prefers-contrast: more) {
  .mcp-wizard,
  .wizard-note { border-width: 2px; }
}
</style>
