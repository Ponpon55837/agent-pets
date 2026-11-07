<script setup lang="ts">
import { t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { PERMISSION_DEFAULT_TTL_SECONDS } from '@/types/permission'
import Card from '@/components/ui/Card.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import Button from '@/components/ui/Button.vue'
import { playCue, type SoundCue } from '@/utils/sound'

const store = useAgentStore()

function setVolume(event: Event): void {
  store.setSoundOption({ soundVolume: Number((event.target as HTMLInputElement).value) })
}

function preview(cue: SoundCue): void {
  playCue(cue, { preview: true })
}
</script>

<template>
  <Card :title="t('windowModes')">
    <ToggleRow :model-value="store.petWindowMode.mode === 'mini'" :label="t('miniMode')" :help="t('miniModeHelp')" @update:model-value="store.setPetMode($event ? 'mini' : 'normal')" />
    <ToggleRow :model-value="store.edgeModeEnabled" :label="t('edgePeek')" :help="t('edgePeekHelp')" @update:model-value="store.setEdgeModeEnabled($event)" />
  </Card>

  <Card :title="t('desktopBehavior')">
    <ToggleRow :model-value="store.shimejiEnabled" :label="t('shimejiBehavior')" :help="t('shimejiBehaviorHelp')" @update:model-value="store.setShimejiEnabled($event)" />
    <ToggleRow
      :model-value="store.captureExclusionEnabled"
      :label="t('captureExclusion')"
      :help="store.desktopVisibilityCapabilities.captureExclusion.supported ? t('captureExclusionHelp') : t('captureExclusionUnavailable')"
      :disabled="!store.desktopVisibilityCapabilities.captureExclusion.supported"
      @update:model-value="store.setCaptureExclusionEnabled($event)"
    />
    <ToggleRow
      :model-value="store.fullscreenAutoHideEnabled"
      :label="t('fullscreenAutoHide')"
      :help="store.desktopVisibilityCapabilities.fullscreenAutoHide.supported ? t('fullscreenAutoHideHelp') : t('fullscreenAutoHideUnavailable')"
      :disabled="!store.desktopVisibilityCapabilities.fullscreenAutoHide.supported"
      @update:model-value="store.setFullscreenAutoHideEnabled($event)"
    />
    <ToggleRow :model-value="store.rightClickHideEnabled" :label="t('rightClickHide')" :help="t('rightClickHideHelp')" @update:model-value="store.setRightClickHideEnabled($event)" />
    <ToggleRow :model-value="store.permissionBubbleEnabled" :label="t('permissionBubble')" :help="t('permissionBubbleHelp', { seconds: PERMISSION_DEFAULT_TTL_SECONDS })" @update:model-value="store.setPermissionBubbleEnabled($event)" />
  </Card>

  <Card :title="t('permission.soundHeading')">
    <ToggleRow :model-value="store.soundEnabled" :label="t('sound')" :help="t('soundHelp')" @update:model-value="store.setSoundEnabled($event)" />
    <label class="permission-sound-volume">
      <span>{{ t('permission.soundVolume') }}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        :value="store.soundVolume"
        :disabled="!store.soundEnabled"
        :aria-valuetext="`${store.soundVolume}%`"
        @input="setVolume"
      />
      <output>{{ store.soundVolume }}%</output>
    </label>
    <ToggleRow :model-value="store.soundOnPermission" :disabled="!store.soundEnabled" :label="t('permission.soundOnPermission')" @update:model-value="store.setSoundOption({ soundOnPermission: $event })" />
    <ToggleRow :model-value="store.soundOnError" :disabled="!store.soundEnabled" :label="t('permission.soundOnError')" @update:model-value="store.setSoundOption({ soundOnError: $event })" />
    <ToggleRow :model-value="store.soundOnSuccess" :disabled="!store.soundEnabled" :label="t('permission.soundOnSuccess')" @update:model-value="store.setSoundOption({ soundOnSuccess: $event })" />
    <div class="permission-sound-preview">
      <Button size="sm" variant="secondary" @click="preview('waiting-permission')">{{ t('permission.soundPreviewPermission') }}</Button>
      <Button size="sm" variant="secondary" @click="preview('error')">{{ t('permission.soundPreviewError') }}</Button>
      <Button size="sm" variant="secondary" @click="preview('success')">{{ t('permission.soundPreviewSuccess') }}</Button>
    </div>
  </Card>

  <Card :title="t('permission.settingsHeading')">
    <p class="permission-settings-intro">{{ t('permission.settingsIntro') }}</p>
    <ul class="permission-settings-list">
      <li>
        <strong>OpenCode</strong>
        <span>{{ t('permission.settingsCanApprove') }}</span>
      </li>
      <li>
        <strong>Codex · Claude</strong>
        <span>{{ t('permission.settingsReminderOnly') }}</span>
      </li>
    </ul>
    <p class="permission-settings-intro">{{ t('permission.settingsRiskRules') }}</p>
  </Card>

  <Card :title="t('system')">
    <ToggleRow :model-value="store.presentationMcpEnabled" :label="t('presentationMcp')" :help="t('presentationMcpHelp')" @update:model-value="store.setPresentationMcpEnabled($event)" />
    <ToggleRow
      :model-value="store.launchAtStartup"
      :label="t('launchAtStartup')"
      :help="store.launchAtStartupSupported ? t('launchAtStartupHelp') : t('availablePackaged')"
      :disabled="!store.launchAtStartupSupported"
      @update:model-value="store.setLaunchAtStartup($event)"
    />
  </Card>
</template>

<style scoped>
.permission-sound-volume {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  font-size: var(--font-sm);
}

.permission-sound-volume input[type='range'] {
  min-width: 0;
  flex: 1;
  accent-color: var(--accent);
}

.permission-sound-volume input[type='range']:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.permission-sound-volume output {
  min-width: 3ch;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.permission-sound-preview {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-2);
}

.permission-settings-intro {
  margin: 0 0 var(--space-3);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: 1.5;
}

.permission-settings-list {
  display: flex;
  margin: 0 0 var(--space-3);
  padding: 0;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
}

.permission-settings-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.permission-settings-list span {
  color: var(--text-secondary);
}
</style>
