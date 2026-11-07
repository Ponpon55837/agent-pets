<script setup lang="ts">
import { computed, ref } from 'vue'
import { locale, t } from '@/i18n'
import { SOURCE_LABELS, STATE_COLORS, STATE_LABELS, STATE_LABELS_SHORT, type AgentSession } from '@/types/agent'
import SessionElapsed from '@/components/status-panel/SessionElapsed.vue'
import { formatTimeFull } from '@/utils/intl-format'

// One active session. The whole row is a disclosure button (keyboard focusable,
// aria-expanded) that reveals the full path, tool and timing; nothing
// interactive is nested inside it.
const props = defineProps<{ session: AgentSession; projectLabel: string; detail: string; live: boolean }>()

const expanded = ref(false)
const detailsId = computed(() => `session-details-${props.session.key.replace(/[^\w-]/g, '_')}`)
const lastSeen = computed(() => formatTimeFull(props.session.lastSeenAt, locale.value))
const title = computed(() => `${SOURCE_LABELS[props.session.source]}${props.projectLabel ? ` · ${props.projectLabel}` : ''}`)
</script>

<template>
  <div class="session-item" :class="{ expanded }">
    <button
      type="button"
      class="session-row"
      :aria-expanded="expanded"
      :aria-controls="detailsId"
      :title="session.project || undefined"
      @click="expanded = !expanded"
    >
      <span
        class="session-status-dot"
        :class="{ live }"
        :style="{ '--status-color': STATE_COLORS[session.state] }"
        aria-hidden="true"
      />
      <span class="session-info">
        <span class="session-title-line">{{ title }}</span>
        <span class="session-detail">{{ detail }}</span>
      </span>
      <span class="session-state-column">
        <span
          class="state-chip"
          :class="[`state-${session.state}`, { live }]"
          :style="{ '--status-color': STATE_COLORS[session.state] }"
          :title="STATE_LABELS[session.state]"
        >{{ STATE_LABELS_SHORT[session.state] }}</span>
        <SessionElapsed v-if="live" :since="session.lastSeenAt" />
        <span v-else class="session-time">{{ lastSeen }}</span>
      </span>
    </button>
    <dl v-if="expanded" :id="detailsId" class="session-details">
      <div v-if="session.project"><dt>{{ t('panel.detailPath') }}</dt><dd class="session-path">{{ session.project }}</dd></div>
      <div v-if="session.toolName"><dt>{{ t('panel.detailTool') }}</dt><dd>{{ session.toolName }}</dd></div>
      <div><dt>{{ t('panel.detailLastSeen') }}</dt><dd>{{ lastSeen }}</dd></div>
      <div><dt>{{ t('panel.detailSessionId') }}</dt><dd class="session-path">{{ session.sessionId }}</dd></div>
    </dl>
  </div>
</template>
