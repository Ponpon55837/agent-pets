<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  panelViewPlugin, panelViewMaximized, pluginName, pluginIconUrl, hidePluginIcon,
  togglePluginPanelViewMaximized, closePluginPanelView,
} = usePluginController()
const emit = defineEmits<{ frame: [el: HTMLElement | null]; content: [el: HTMLElement | null] }>()
</script>

<template>
<section
  v-if="panelViewPlugin"
  :ref="(el) => emit('frame', el as HTMLElement | null)"
  class="plugin-panel-view-frame"
  :class="{ 'is-maximized': panelViewMaximized }"
  data-testid="plugin-panel-view-frame"
>
  <header class="plugin-panel-view-chrome">
    <img v-if="pluginIconUrl(panelViewPlugin)" :src="pluginIconUrl(panelViewPlugin) ?? ''" alt="" @error="hidePluginIcon(panelViewPlugin.id)" />
    <span v-else class="plugin-panel-view-icon" aria-hidden="true">◇</span>
    <div class="plugin-panel-view-title">
      <strong>{{ pluginName(panelViewPlugin) }}</strong>
      <span>{{ t('pluginPanelContent') }}</span>
    </div>
    <Button
      variant="ghost"
      icon-only
      class="plugin-panel-view-control"
      :aria-label="t(panelViewMaximized ? 'pluginPanelRestore' : 'pluginPanelMaximize')"
      :title="t(panelViewMaximized ? 'pluginPanelRestore' : 'pluginPanelMaximize')"
      :aria-pressed="panelViewMaximized"
      @click="togglePluginPanelViewMaximized"
    >
      <Icon :name="panelViewMaximized ? 'restore' : 'maximize'" :size="18" />
    </Button>
    <Button
      variant="ghost"
      icon-only
      class="plugin-panel-view-control plugin-panel-view-close"
      :aria-label="t('pluginPanelClose')"
      :title="t('pluginPanelClose')"
      @click="closePluginPanelView"
    >
      <Icon name="close" :size="18" />
    </Button>
  </header>
  <div :ref="(el) => emit('content', el as HTMLElement | null)" class="plugin-panel-view-content" data-testid="plugin-panel-view-content" />
</section>
</template>

<style scoped src="./PluginPanelFrame.css"></style>
