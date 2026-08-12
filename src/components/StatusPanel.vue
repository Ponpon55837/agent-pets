<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from '../stores/agentStore'
import { STATE_LABELS, SOURCE_LABELS, STATE_COLORS, STATE_PRIORITY, SOURCE_FAMILIES } from '../types/agent'
import { formatProject } from '../utils/format'

const store = useAgentStore()
const importing = ref(false)
const editingPetId = ref<string | null>(null)
const editName = ref('')
const settingsTab = ref<'general' | 'pets'>('general')
const dashboardTab = ref<'sessions' | 'usage'>('sessions')
const quotaUsage = computed(() => store.quotaUsage)
const quotaLoading = computed(() => store.quotaLoading)
const quotaError = computed(() => store.quotaError)
const moodStage = computed(() => {
  if (store.mood >= 90) return 'Overdrive'
  if (store.mood >= 70) return 'Radiant'
  if (store.mood >= 40) return 'Charged'
  return 'Resting'
})

watch(() => store.panelView, (view) => {
  if (view === 'settings') settingsTab.value = 'general'
})

// Drives the "Xs" elapsed-time readout on in-flight sessions (thinking /
// tool-running / waiting-*), matching the "Churning 7.2s" style loader.
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

async function refreshQuota(force = false) {
  await store.refreshQuota(force)
}

function selectDashboardTab(tab: 'sessions' | 'usage') {
  dashboardTab.value = tab
  if (tab === 'usage' && !quotaUsage.value) void refreshQuota()
}

function formatRemaining(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded}% left`
}

function formatReset(timestamp?: string): string {
  if (!timestamp) return 'Reset time unavailable'
  const reset = new Date(timestamp).getTime()
  if (!Number.isFinite(reset)) return 'Reset time unavailable'
  const deltaMinutes = Math.max(0, Math.round((reset - nowTick.value) / 60_000))
  if (deltaMinutes < 1) return 'Resets now'
  if (deltaMinutes < 60) return `Resets in ${deltaMinutes}m`
  const hours = Math.floor(deltaMinutes / 60)
  const minutes = deltaMinutes % 60
  if (hours < 24) return `Resets in ${hours}h${minutes ? ` ${minutes}m` : ''}`
  const days = Math.floor(hours / 24)
  return `Resets in ${days}d ${hours % 24}h`
}

function formatResetAt(timestamp?: string): string {
  if (!timestamp) return ''
  const reset = new Date(timestamp)
  if (!Number.isFinite(reset.getTime())) return ''
  return reset.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUpdated(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const LIVE_STATES = new Set(['thinking', 'tool-running', 'waiting-permission', 'waiting-input'])

function elapsedLabel(session: { state: string; lastSeenAt: number }): string | null {
  if (!LIVE_STATES.has(session.state)) return null
  const secs = Math.max(0, (nowTick.value - session.lastSeenAt) / 1000)
  return `${secs.toFixed(1)}s`
}

// Pet + panel are separate windows with separate store instances now — this
// window must load its own copy of the pets list rather than relying on the
// pet window having already populated it.
onMounted(() => {
  store.loadPets()
})

function startRename(pet: { id: string; displayName: string }) {
  editingPetId.value = pet.id
  editName.value = pet.displayName
}

async function confirmRename() {
  if (!editingPetId.value || !editName.value.trim()) {
    editingPetId.value = null
    return
  }
  await store.renamePet(editingPetId.value, editName.value.trim())
  editingPetId.value = null
}

function cancelRename() {
  editingPetId.value = null
  editName.value = ''
}

const sessions = computed(() => {
  return Object.values(store.sessions).sort((a, b) => {
    const priorityDelta = (STATE_PRIORITY[b.state] ?? 0) - (STATE_PRIORITY[a.state] ?? 0)
    if (priorityDelta !== 0) return priorityDelta

    const recencyDelta = b.lastSeenAt - a.lastSeenAt
    if (recencyDelta !== 0) return recencyDelta

    return SOURCE_LABELS[a.source].localeCompare(SOURCE_LABELS[b.source])
  })
})

const hasOffline = computed(() => sessions.value.some((s) => s.state === 'offline'))

const scaleOptions = [
  { value: 0.6, label: 'S' },
  { value: 0.8, label: 'M' },
  { value: 1.0, label: 'L' },
  { value: 1.2, label: 'XL' },
  { value: 1.5, label: 'XXL' },
]

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

async function importPet() {
  importing.value = true
  const id = `custom-${Date.now()}`
  const fileUrl = await window.electronAPI?.importPetSprite(id, 'Custom Pet')
  if (fileUrl) {
    await store.loadPets()
    store.setPet(id)
  }
  importing.value = false
}

const importingZip = ref(false)
const importZipError = ref('')

async function importPetZip() {
  importingZip.value = true
  importZipError.value = ''
  const result = await window.electronAPI?.importPetZip()
  if (result?.ok && result.id) {
    await store.loadPets()
    store.setPet(result.id)
  } else if (result && !result.ok && result.error !== 'cancelled') {
    importZipError.value = result.error || 'Import failed'
  }
  importingZip.value = false
}

function quitApp() {
  window.electronAPI?.quitApp()
}

function restartApp() {
  window.electronAPI?.restartApp()
}

function confirmRemovePet(pet: { id: string; displayName: string; builtIn: boolean }) {
  const message = pet.builtIn
    ? `Hide "${pet.displayName}" from your pet list? You can't undo this from the UI, but the bundled sprite itself is untouched.`
    : `Remove "${pet.displayName}"? This deletes the imported sprite files and can't be undone.`
  if (window.confirm(message)) {
    store.removePet(pet.id)
  }
}
</script>

<template>
  <div class="status-panel" @click.stop>
    <div class="panel-header">
      <button
        v-if="store.panelView === 'settings'"
        class="header-btn"
        @click="store.backToSessions()"
      >
        &#8249;
      </button>
      <span class="panel-title">
        {{ store.panelView === 'sessions' ? 'Agent Pets' : 'Settings' }}
      </span>
      <div class="header-right">
        <button
          v-if="store.panelView === 'sessions'"
          class="header-btn"
          title="Settings"
          @click="store.openSettings()"
        >
          &#9881;
        </button>
        <button class="header-btn" @click="store.closePanel()">&times;</button>
      </div>
    </div>

    <template v-if="store.panelView === 'sessions'">
      <div class="dashboard-tabs" role="tablist" aria-label="Dashboard sections">
        <button
          class="dashboard-tab"
          :class="{ active: dashboardTab === 'sessions' }"
          role="tab"
          :aria-selected="dashboardTab === 'sessions'"
          @click="selectDashboardTab('sessions')"
        >
          Sessions
        </button>
        <button
          class="dashboard-tab"
          :class="{ active: dashboardTab === 'usage' }"
          role="tab"
          :aria-selected="dashboardTab === 'usage'"
          @click="selectDashboardTab('usage')"
        >
          Usage
        </button>
      </div>

      <template v-if="dashboardTab === 'sessions'">
        <div v-if="sessions.length === 0" class="panel-empty">
          No active sessions
        </div>
        <template v-else>
          <div class="session-list">
            <div
              v-for="session in sessions"
              :key="session.key"
              class="session-item"
            >
              <div class="session-source">
                {{ SOURCE_LABELS[session.source] }}
              </div>
              <div class="session-info">
                <span
                  class="state-chip"
                  :class="{ live: LIVE_STATES.has(session.state) }"
                  :style="{ color: STATE_COLORS[session.state], borderColor: STATE_COLORS[session.state] + '40', background: STATE_COLORS[session.state] + '1a' }"
                >
                  <span class="state-dot" :style="{ background: STATE_COLORS[session.state] }" />
                  {{ STATE_LABELS[session.state] }}
                  <span v-if="elapsedLabel(session)" class="state-elapsed">{{ elapsedLabel(session) }}</span>
                </span>
                <span v-if="session.project" class="session-project">
                  {{ formatProject(session.project) }}
                </span>
              </div>
              <div class="session-time">
                {{ formatTime(session.lastSeenAt) }}
              </div>
            </div>
          </div>
          <div v-if="hasOffline" class="session-footer">
            <button class="clear-offline-btn" @click="store.clearOfflineSessions()">
              Clear offline
            </button>
          </div>
        </template>
      </template>

      <template v-else>
        <div class="usage-view">
          <div v-if="quotaLoading && !quotaUsage" class="panel-empty usage-loading">
            Loading quota…
          </div>
          <div v-else-if="quotaError && !quotaUsage" class="panel-empty usage-error">
            {{ quotaError }}
          </div>
          <template v-else-if="quotaUsage">
            <div
              v-for="provider in quotaUsage.providers"
              :key="provider.id"
              class="usage-provider"
              :class="`provider-${provider.id}`"
            >
              <div class="usage-provider-header">
                <span class="usage-provider-name">{{ provider.name }}</span>
                <span v-if="provider.plan" class="usage-plan">{{ provider.plan }}</span>
              </div>
              <div v-if="provider.error" class="usage-provider-error">
                {{ provider.error }}
              </div>
              <div v-else class="quota-window-list">
                <div v-for="quota in provider.windows" :key="quota.id" class="quota-window">
                  <div class="quota-copy">
                    <span class="quota-label">{{ quota.label }}</span>
                    <span class="quota-value">{{ formatRemaining(quota.remainingPercent) }}</span>
                  </div>
                  <div
                    class="quota-track"
                    role="progressbar"
                    :aria-label="`${provider.name} ${quota.label} remaining`"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuenow="quota.remainingPercent"
                  >
                    <div class="quota-fill" :style="{ width: quota.remainingPercent + '%' }" />
                  </div>
                  <div class="quota-reset">
                    <span>{{ formatReset(quota.resetsAt) }}</span>
                    <span v-if="formatResetAt(quota.resetsAt)" class="quota-reset-at">
                      {{ formatResetAt(quota.resetsAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div class="usage-footer">
              <span>Updated {{ formatUpdated(quotaUsage.updatedAt) }}</span>
              <button class="usage-refresh" :disabled="quotaLoading" @click="refreshQuota(true)">
                {{ quotaLoading ? 'Refreshing…' : 'Refresh' }}
              </button>
            </div>
          </template>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        <button
          class="settings-tab"
          :class="{ active: settingsTab === 'general' }"
          role="tab"
          :aria-selected="settingsTab === 'general'"
          @click="settingsTab = 'general'"
        >
          Settings
        </button>
        <button
          class="settings-tab"
          :class="{ active: settingsTab === 'pets' }"
          role="tab"
          :aria-selected="settingsTab === 'pets'"
          @click="settingsTab = 'pets'"
        >
          Pets
        </button>
      </div>

      <div class="settings-content">
        <template v-if="settingsTab === 'general'">
          <div class="settings-section">
            <div class="mood-header">
              <div class="mood-title">
                <div class="section-label">Mood</div>
                <span class="mood-readout">{{ store.mood }} · {{ moodStage }}</span>
              </div>
              <button class="mood-reset-btn" title="Reset to baseline" @click="store.resetMood()">Reset</button>
            </div>
            <div
              class="mood-bar"
              role="progressbar"
              aria-label="Pet mood"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="store.mood"
            >
              <div class="mood-fill" :style="{ width: store.mood + '%' }" />
            </div>
          </div>

          <div class="settings-section">
            <div class="section-label">Size</div>
            <div class="scale-options">
              <div
                v-for="opt in scaleOptions"
                :key="opt.value"
                class="scale-option"
                :class="{ active: store.petScale === opt.value }"
                @click="store.setScale(opt.value)"
              >
                {{ opt.label }}
              </div>
            </div>
          </div>

          <div class="settings-section toggle-group desktop-toggle-group">
            <div class="section-label group-label">Desktop</div>
            <label class="toggle-row">
              <span class="setting-copy">
                <span class="section-label">Do Not Disturb</span>
                <span class="setting-help">Mute sounds, notifications, and extra motion</span>
              </span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.dndEnabled"
                  @change="store.setDndEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>

            <label class="toggle-row">
              <span class="setting-copy">
                <span class="section-label">Notifications</span>
                <span class="setting-help">Show native waiting and completion alerts</span>
              </span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.notificationsEnabled"
                  @change="store.setNotificationsEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>

            <label class="toggle-row">
              <span class="setting-copy">
                <span class="section-label">Sound</span>
                <span class="setting-help">Play the pet's local status cues</span>
              </span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.soundEnabled"
                  @change="store.setSoundEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>

            <label
              class="toggle-row"
              :class="{ 'is-disabled': !store.launchAtStartupSupported }"
              :title="store.launchAtStartupSupported ? 'Start Agent Pets when you sign in' : 'Available in packaged builds'"
            >
              <span class="setting-copy">
                <span class="section-label">Launch at startup</span>
                <span class="setting-help">
                  {{ store.launchAtStartupSupported ? 'Start when you sign in' : 'Available after installation' }}
                </span>
              </span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.launchAtStartup"
                  :disabled="!store.launchAtStartupSupported"
                  @change="store.setLaunchAtStartup(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>
          </div>

          <div class="settings-section toggle-group">
            <div class="section-label group-label">Pet reactions</div>

            <label class="toggle-row">
              <span class="section-label">Bounce &amp; shake</span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.reactionsEnabled"
                  @change="store.setReactionsEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>

            <label class="toggle-row">
              <span class="section-label">Bubble</span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.bubbleEnabled"
                  @change="store.setBubbleEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>
          </div>

          <div class="settings-section">
            <button class="setup-btn" @click="store.showWizard = true">Setup Wizard</button>
          </div>

          <div class="settings-section">
            <button class="restart-btn" @click="restartApp">Restart Pet</button>
          </div>

          <div class="settings-section">
            <button class="quit-btn" @click="quitApp">Quit</button>
          </div>
        </template>

        <template v-else>
          <div class="settings-section">
            <div class="section-label">Pet</div>
            <div class="pet-list">
              <div
                v-for="pet in store.visiblePets"
                :key="pet.id"
                class="pet-option"
                :class="{ active: store.selectedPet === pet.id }"
                @click="store.setPet(pet.id)"
              >
                <template v-if="editingPetId === pet.id">
                  <input
                    v-model="editName"
                    class="pet-rename-input"
                    maxlength="64"
                    @keyup.enter="confirmRename"
                    @keyup.escape="cancelRename"
                    @blur="confirmRename"
                    @click.stop
                  />
                </template>
                <template v-else>
                  <span class="pet-name">{{ pet.displayName }}</span>
                  <button
                    v-if="!pet.builtIn"
                    class="pet-edit"
                    title="Rename"
                    @click.stop="startRename(pet)"
                  >
                    &#9998;
                  </button>
                  <button
                    v-if="pet.id !== store.defaultPetId"
                    class="pet-remove"
                    :title="pet.builtIn ? 'Hide' : 'Remove'"
                    @click.stop="confirmRemovePet(pet)"
                  >
                    &times;
                  </button>
                </template>
              </div>
            </div>
            <div class="import-row">
              <button class="import-btn" @click="importPet" :disabled="importing">
                {{ importing ? 'Importing...' : '+ Import Sprite' }}
              </button>
              <button class="import-btn" @click="importPetZip" :disabled="importingZip">
                {{ importingZip ? 'Importing...' : '+ Import .zip' }}
              </button>
            </div>
            <div v-if="importZipError" class="import-error">{{ importZipError }}</div>
          </div>

          <div class="settings-section toggle-group">
            <label class="toggle-row">
              <span class="section-label">Multi-pet</span>
              <span class="switch">
                <input
                  type="checkbox"
                  :checked="store.multiPetEnabled"
                  @change="store.setMultiPetEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="switch-track"><span class="switch-thumb" /></span>
              </span>
            </label>
          </div>

          <div v-if="store.multiPetEnabled" class="settings-section">
            <div class="section-label">Per-Agent Pet</div>
            <div class="family-pet-list">
              <label v-for="family in SOURCE_FAMILIES" :key="family.key" class="family-pet-row">
                <span class="family-pet-name">
                  <span class="family-pet-dot" :class="`family-${family.key}`" />
                  {{ family.label }}
                </span>
                <select
                  class="family-pet-select"
                  :value="store.familyPetIds[family.key] || ''"
                  @change="store.setFamilyPet(family.key, ($event.target as HTMLSelectElement).value || null)"
                >
                  <option value="">Default</option>
                  <option v-for="pet in store.visiblePets" :key="pet.id" :value="pet.id">
                    {{ pet.displayName }}
                  </option>
                </select>
              </label>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.status-panel {
  position: relative;
  width: 100%;
  height: 100%;
  /* A dark solid layer sits underneath the sheen/tint so text stays legible
     no matter what's behind the window (bright desktop wallpaper, video,
     etc.) — the glass look comes from the blur + highlight, not from
     letting the backdrop show through at full strength. */
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.015) 22%, rgba(255, 255, 255, 0) 45%),
    rgba(18, 18, 26, 0.86);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  backdrop-filter: blur(24px) saturate(165%);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.4),
    0 2px 6px rgba(0, 0, 0, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.03),
    inset 0 -18px 30px -20px rgba(0, 0, 0, 0.35);
  z-index: 9999;
  display: flex;
  flex-direction: column;
}

.status-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 8%;
  right: 8%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  pointer-events: none;
}

.panel-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0));
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.panel-title {
  font-weight: 600;
  font-size: 13px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
}

.header-right {
  display: flex;
  gap: 4px;
}

.header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  color: #a8adbd;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.header-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.14);
}

.panel-empty {
  padding: 20px 14px;
  text-align: center;
  color: #a3a7b4;
  font-size: 12px;
}

.dashboard-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 8px 12px 4px;
}

.dashboard-tab {
  padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: #9298aa;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.dashboard-tab:hover {
  color: #d0d3df;
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.14);
}

.dashboard-tab.active {
  color: #e5e7ff;
  background: rgba(139, 156, 247, 0.22);
  border-color: rgba(139, 156, 247, 0.4);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 10px rgba(139, 156, 247, 0.18);
}

.usage-view {
  min-height: 0;
  padding: 4px 10px 10px;
  overflow-y: auto;
}

.usage-loading {
  animation: usage-pulse 1.2s ease-in-out infinite;
}

@keyframes usage-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.usage-error,
.usage-provider-error {
  color: #ff9a9a;
}

.usage-provider {
  margin-top: 6px;
  padding: 10px;
  border: 1px solid rgba(139, 156, 247, 0.13);
  border-radius: 10px;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.05), rgba(139, 156, 247, 0.045));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.usage-provider.provider-claude {
  border-color: rgba(213, 155, 255, 0.13);
  background: rgba(213, 155, 255, 0.04);
}

.usage-provider-header,
.quota-copy,
.usage-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.usage-provider-name {
  color: #e0e3ef;
  font-size: 12px;
  font-weight: 650;
}

.usage-plan {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  color: #aeb4c5;
  font-size: 9px;
}

.usage-provider-error {
  padding-top: 8px;
  font-size: 10px;
  line-height: 1.45;
}

.quota-window-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.quota-label {
  color: #b7bccb;
  font-size: 10px;
}

.quota-value {
  color: #f1f3ff;
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.quota-track {
  height: 6px;
  margin-top: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
}

.quota-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #667eea, #8b9cf7);
  transition: width 0.35s ease;
}

.provider-claude .quota-fill {
  background: linear-gradient(90deg, #b56ee2, #d59bff);
}

.quota-reset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  color: #858b9b;
  font-size: 9px;
}

.quota-reset-at {
  color: #a3a8b7;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.usage-footer {
  padding: 9px 2px 0;
  color: #858b9b;
  font-size: 9px;
}

.usage-refresh {
  padding: 4px 9px;
  border: 1px solid rgba(139, 156, 247, 0.23);
  border-radius: 6px;
  background: rgba(139, 156, 247, 0.08);
  color: #adb8ff;
  font: inherit;
  font-size: 9px;
  cursor: pointer;
}

.usage-refresh:hover:not(:disabled) {
  background: rgba(139, 156, 247, 0.15);
}

.usage-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

.session-list {
  padding: 6px;
  overflow-y: auto;
  max-height: 320px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  transition: background 0.15s;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.session-source {
  font-weight: 600;
  font-size: 11px;
  min-width: 50px;
  color: #8b9cf7;
}

.session-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.state-chip {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: fit-content;
  padding: 2px 8px 2px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.state-chip.live .state-dot {
  animation: pulse-dot 1.2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}

.state-elapsed {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  font-size: 10px;
}

.session-project {
  font-size: 10px;
  color: #a4a8b4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
}

.session-time {
  font-size: 10px;
  color: #8f94a3;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
}

.session-footer {
  padding: 4px 10px 8px;
  display: flex;
  justify-content: flex-end;
}

.clear-offline-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: #a4a8b4;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
}

.clear-offline-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
}

.settings-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 8px 12px 4px;
}

.settings-tab {
  padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: #9298aa;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.settings-tab:hover {
  color: #d0d3df;
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.14);
}

.settings-tab.active {
  color: #e5e7ff;
  background: rgba(139, 156, 247, 0.22);
  border-color: rgba(139, 156, 247, 0.4);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 10px rgba(139, 156, 247, 0.18);
}

.settings-content {
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.family-pet-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 3px 0;
}

.family-pet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  padding: 3px 5px 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  transition: border-color 0.15s, background 0.15s;
}

.family-pet-row:hover {
  border-color: rgba(139, 156, 247, 0.25);
  background: rgba(139, 156, 247, 0.06);
}

.family-pet-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #c8c8d2;
  font-size: 11px;
  font-weight: 500;
}

.family-pet-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
}

.family-pet-dot.family-codex {
  color: #8b9cf7;
  background: #8b9cf7;
}

.family-pet-dot.family-claude {
  color: #d59bff;
  background: #d59bff;
}

.family-pet-dot.family-opencode {
  color: #50c878;
  background: #50c878;
}

.family-pet-select {
  width: 132px;
  min-width: 0;
  appearance: none;
  -webkit-appearance: none;
  padding: 6px 28px 6px 9px;
  border: 1px solid rgba(139, 156, 247, 0.22);
  border-radius: 6px;
  outline: none;
  background-color: rgba(17, 17, 27, 0.9);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='m1 1 4 4 4-4' fill='none' stroke='%238b9cf7' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 9px center;
  color: #cdd4ff;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
}

.family-pet-select:hover {
  border-color: rgba(139, 156, 247, 0.5);
  background-color: rgba(30, 30, 45, 0.95);
}

.family-pet-select:focus {
  border-color: #8b9cf7;
  box-shadow: 0 0 0 2px rgba(139, 156, 247, 0.14);
}

.family-pet-select option {
  background: #1b1b29;
  color: #ddd;
}

.section-label {
  font-size: 10px;
  color: #9da3b5;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
}

.pet-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 140px;
  overflow-y: auto;
}

.pet-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 6px;
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.pet-option:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.pet-option.active {
  background: rgba(139, 156, 247, 0.15);
  color: #8b9cf7;
}

.pet-name {
  flex: 1;
}

.pet-rename-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(139, 156, 247, 0.4);
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  padding: 2px 6px;
  outline: none;
  font-family: inherit;
}

.pet-rename-input:focus {
  border-color: #8b9cf7;
}

.pet-edit {
  background: none;
  border: none;
  color: #9499aa;
  font-size: 13px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.pet-edit:hover {
  color: #8b9cf7;
}

.pet-remove {
  background: none;
  border: none;
  color: #9499aa;
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.pet-remove:hover {
  color: #ff6b6b;
}

.import-row {
  display: flex;
  gap: 6px;
}

.import-error {
  font-size: 10px;
  color: #ff6b6b;
}

.import-btn {
  flex: 1;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(80, 200, 120, 0.25);
  background: rgba(80, 200, 120, 0.06);
  color: #50c878;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.import-btn:hover {
  background: rgba(80, 200, 120, 0.12);
}

.import-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-group {
  gap: 8px;
}

.desktop-toggle-group {
  padding: 8px 9px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.025);
}

.group-label {
  padding-bottom: 2px;
  color: #d9dce8;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 31px;
  cursor: pointer;
}

.toggle-row.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.setting-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.setting-help {
  color: #9da3b4;
  font-size: 10px;
  line-height: 1.3;
}

.switch {
  position: relative;
  display: inline-flex;
  width: 34px;
  height: 20px;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}

.switch-track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s ease;
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s ease;
}

.switch input:checked ~ .switch-track {
  background: #8b9cf7;
}

.switch input:checked ~ .switch-track .switch-thumb {
  transform: translateX(14px);
}

.switch input:focus-visible ~ .switch-track {
  outline: 2px solid rgba(173, 184, 255, 0.95);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(139, 156, 247, 0.16);
}

.switch input:disabled ~ .switch-track {
  background: rgba(255, 255, 255, 0.08);
}

.mood-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mood-reset-btn {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: #a4a8b4;
  font-size: 9px;
  cursor: pointer;
}

.mood-reset-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
}

.mood-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.mood-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #ff6b6b, #c8b450, #50c878);
  transition: width 0.3s ease;
}

.scale-options {
  display: flex;
  gap: 4px;
}

.scale-option {
  flex: 1;
  padding: 5px 0;
  border-radius: 5px;
  color: #a4a8b4;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s;
}

.scale-option:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
}

.scale-option.active {
  background: rgba(139, 156, 247, 0.18);
  color: #8b9cf7;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 0 8px rgba(139, 156, 247, 0.15);
}

.setup-btn,
.restart-btn,
.quit-btn,
.import-btn {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.setup-btn {
  width: 100%;
  padding: 7px 12px;
  border-radius: 6px;
  border: 1px solid rgba(139, 156, 247, 0.2);
  background: rgba(139, 156, 247, 0.06);
  color: #8b9cf7;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.setup-btn:hover {
  background: rgba(139, 156, 247, 0.12);
}

.mood-title {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.mood-readout {
  color: #cbd2e8;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
}

.restart-btn {
  width: 100%;
  padding: 7px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 190, 90, 0.25);
  background: rgba(255, 190, 90, 0.06);
  color: #ffc56d;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.restart-btn:hover {
  background: rgba(255, 190, 90, 0.14);
  border-color: rgba(255, 190, 90, 0.42);
}

.quit-btn {
  width: 100%;
  padding: 7px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.06);
  color: #ff6b6b;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.quit-btn:hover {
  background: rgba(255, 80, 80, 0.15);
  border-color: rgba(255, 80, 80, 0.4);
}

@media (prefers-reduced-motion: reduce) {
  .switch-track,
  .switch-thumb,
  .settings-tab,
  .dashboard-tab {
    transition-duration: 0.01ms;
  }
}

@media (prefers-contrast: more) {
  .status-panel {
    background: rgba(12, 12, 18, 0.97);
    border-color: rgba(255, 255, 255, 0.42);
  }

  .desktop-toggle-group,
  .toggle-row {
    border-color: rgba(255, 255, 255, 0.22);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .status-panel {
    background: rgb(18, 18, 26);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
