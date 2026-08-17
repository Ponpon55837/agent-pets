<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PermissionDecisionValue, PermissionRequestView } from '@/types/permission'
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

const props = defineProps<{
  request: PermissionRequestView
  title: string
  projectLabel: string
  elapsedLabel: string
  allowLabel: string
  denyLabel: string
  warningLabel: string
}>()

const emit = defineEmits<{
  decide: [decision: PermissionDecisionValue]
}>()

const deciding = ref<PermissionDecisionValue | null>(null)

watch(() => props.request.requestId, () => {
  deciding.value = null
})

const canAllow = () => props.request.allowedDecisions.includes('allow_once')
const canDeny = () => props.request.allowedDecisions.includes('deny')

function decide(decision: PermissionDecisionValue): void {
  if (props.request.status !== 'pending' || deciding.value) return
  if (decision === 'allow_once' && !canAllow()) return
  if (decision === 'deny' && !canDeny()) return
  deciding.value = decision
  emit('decide', decision)
}
</script>

<template>
  <section
    class="inline-permission-card"
    aria-labelledby="inline-permission-title"
    aria-describedby="inline-permission-context"
  >
    <div class="inline-permission-heading">
      <Icon name="warning" :size="18" />
      <div class="inline-permission-copy">
        <strong id="inline-permission-title">{{ title }}</strong>
        <span id="inline-permission-context">
          {{ projectLabel }} · {{ elapsedLabel }} · <code>{{ request.action }}</code>
        </span>
      </div>
    </div>
    <p class="inline-permission-description" :title="request.description">
      {{ request.description }}
    </p>
    <p v-if="request.truncated" class="inline-permission-warning">{{ warningLabel }}</p>
    <div class="inline-permission-actions">
      <Button
        v-if="canAllow()"
        variant="primary"
        class="permission-button permission-allow"
        :disabled="request.status !== 'pending' || deciding !== null"
        @click="decide('allow_once')"
      >
        {{ deciding === 'allow_once' ? t('sending') : allowLabel }}
      </Button>
      <Button
        v-if="canDeny()"
        variant="secondary"
        class="permission-button permission-deny"
        :disabled="request.status !== 'pending' || deciding !== null"
        @click="decide('deny')"
      >
        {{ deciding === 'deny' ? t('sending') : denyLabel }}
      </Button>
    </div>
  </section>
</template>

<style scoped>
.inline-permission-card {
  display: flex;
  flex-direction: column;
  gap: var(--organic-space-3, var(--space-3));
  padding: 15px var(--organic-space-4, var(--space-4));
  border-radius: var(--organic-radius-md, var(--radius-md));
  background: var(--accent);
  color: var(--accent-bright);
  box-shadow: var(--shadow-hero, var(--shadow-panel));
}

.inline-permission-heading {
  display: flex;
  align-items: flex-start;
  gap: var(--organic-space-2, var(--space-2));
}

.inline-permission-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.inline-permission-copy strong {
  overflow: hidden;
  font-family: var(--font-heading, var(--font-ui));
  font-size: var(--font-heading-sm, var(--font-md));
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-permission-copy span,
.inline-permission-description,
.inline-permission-warning {
  font-size: var(--font-body-sm, var(--font-sm));
  line-height: 1.45;
}

.inline-permission-copy span {
  overflow: hidden;
  opacity: 0.86;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-permission-copy code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.inline-permission-description,
.inline-permission-warning {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.inline-permission-description {
  opacity: 0.88;
}

.inline-permission-warning {
  -webkit-line-clamp: 1;
  color: var(--accent-bright);
  font-weight: var(--weight-medium);
}

.inline-permission-actions {
  display: flex;
  gap: var(--organic-space-2, var(--space-2));
}

.permission-button {
  flex: 1;
}

.permission-allow {
  border-color: var(--accent-bright);
  background: var(--accent-bright);
  color: var(--accent-text, var(--text-primary));
}

.permission-allow:hover:not(:disabled) {
  border-color: var(--accent-soft);
  background: var(--accent-soft);
}

.permission-deny {
  border-color: var(--border-on-accent, var(--border-strong));
  background: transparent;
  color: var(--accent-bright);
}

.permission-deny:hover:not(:disabled) {
  border-color: var(--accent-bright);
  background: var(--accent-on-hover, var(--surface-raised-hover));
  color: var(--accent-bright);
}
</style>
