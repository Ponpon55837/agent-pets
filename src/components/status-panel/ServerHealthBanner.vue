<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import type { LocalServerHealth } from '@/types/reliability'

const servers = ref<LocalServerHealth[]>([])
let dispose: (() => void) | null = null

const offline = computed(() => servers.value.filter(server => server.state === 'retrying' || server.state === 'failed'))

function describe(server: LocalServerHealth): string {
  const name = t(`reliability.server.name.${server.id}`)
  if (server.state === 'failed') return `${name}：${t('reliability.server.bannerFailed', { port: server.port, code: server.code ?? 'UNKNOWN' })}`
  if (server.occupant === 'agent-pets') return `${name}：${t('reliability.server.bannerBusyAgentPets', { port: server.port })}`
  return `${name}：${t('reliability.server.bannerBusy', { port: server.port, attempt: server.attempt })}`
}

function retry() {
  void window.electronAPI?.retryServerHealth?.().then(snapshot => { servers.value = snapshot.servers }).catch(() => {})
}

onMounted(() => {
  void window.electronAPI?.getServerHealth?.().then(snapshot => { servers.value = snapshot.servers }).catch(() => {})
  dispose = window.electronAPI?.onServerHealthChanged?.(snapshot => { servers.value = snapshot.servers }) ?? null
})
onUnmounted(() => dispose?.())
</script>

<template>
  <div v-if="offline.length > 0" class="server-health-banner" role="alert">
    <Icon name="warning" :size="18" />
    <div class="server-health-text">
      <strong>{{ t('reliability.server.bannerTitle') }}</strong>
      <small v-for="server in offline" :key="server.id">{{ describe(server) }}</small>
    </div>
    <Button size="sm" variant="secondary" @click="retry">{{ t('reliability.server.retry') }}</Button>
  </div>
</template>

<style scoped>
.server-health-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--organic-space-2);
  margin: 0 var(--organic-space-4) var(--organic-space-3);
  padding: var(--organic-space-3) var(--organic-space-4);
  border-radius: var(--organic-radius-md);
  background: var(--organic-surface-warm);
  color: var(--organic-accent-text);
}

.server-health-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.server-health-text strong {
  font-family: var(--font-heading);
  font-size: var(--font-heading-sm);
}

.server-health-text small {
  font-size: var(--font-body-sm);
  line-height: 1.45;
}
</style>
