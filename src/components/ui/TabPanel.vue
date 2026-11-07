<script setup lang="ts">
import { panelDomId, tabDomId } from '@/utils/tab-navigation'

// Content region for <Tabs>. Hidden panels get the `hidden` attribute, so
// their focusable content leaves the tab order and the accessibility tree
// while the component (and its state) stays mounted — the v-show behaviour,
// done correctly.
defineProps<{
  idPrefix: string
  id: string
  active: boolean
}>()
</script>

<template>
  <div
    :id="panelDomId(idPrefix, id)"
    class="tab-panel"
    role="tabpanel"
    :aria-labelledby="tabDomId(idPrefix, id)"
    :hidden="!active"
  >
    <slot />
  </div>
</template>

<style scoped>
.tab-panel[hidden] {
  display: none;
}
</style>
