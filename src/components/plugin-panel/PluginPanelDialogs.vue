<script setup lang="ts">
import { t } from '@/i18n'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

defineProps<{
  removeName: string
  keepData: boolean
  secretConsentOpen: boolean
}>()

const emit = defineEmits<{
  confirmRemove: []
  cancelRemove: []
  updateKeepData: [value: boolean]
  confirmSecretConsent: []
  cancelSecretConsent: []
}>()
</script>

<template>
  <ConfirmDialog
    :open="Boolean(removeName)"
    :title="t('pluginRemoveConfirmTitle', { name: removeName })"
    :message="t('pluginRemoveConfirmHelp')"
    :confirm-label="t('remove')"
    :cancel-label="t('cancel')"
    tone="danger"
    @confirm="emit('confirmRemove')"
    @cancel="emit('cancelRemove')"
  >
    <label class="plugin-keep-data">
      <input type="checkbox" :checked="keepData" @change="emit('updateKeepData', ($event.target as HTMLInputElement).checked)" />
      <span>{{ t('pluginKeepData') }}</span>
    </label>
  </ConfirmDialog>

  <ConfirmDialog
    :open="secretConsentOpen"
    :title="t('pluginSecretConsentTitle')"
    :message="t('pluginSecretConsentMessage')"
    :confirm-label="t('pluginSecretConsentConfirm')"
    :cancel-label="t('cancel')"
    @confirm="emit('confirmSecretConsent')"
    @cancel="emit('cancelSecretConsent')"
  />
</template>

<style scoped>
.plugin-keep-data { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--font-sm); }
.plugin-keep-data input { accent-color: var(--accent); }
</style>
