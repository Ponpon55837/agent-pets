<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import { usePluginController } from '@/composables/plugin/context'

const {
  notifications,
  notificationSource,
  notificationTime,
  markNotificationRead,
  openNotificationLink,
  clearNotifications,
} = usePluginController()
</script>

<template>
  <section class="plugin-section">
    <div class="plugin-section-heading">
      <div>
        <h3>{{ t('pluginNotificationsHeading') }}</h3>
        <p>{{ t('pluginNotificationsHelp') }}</p>
      </div>
      <Button variant="secondary" size="sm" :disabled="notifications.length === 0" @click="clearNotifications()">
        {{ t('pluginClearAll') }}
      </Button>
    </div>
    <div v-if="notifications.length === 0" class="plugin-empty">{{ t('pluginNoNotifications') }}</div>
    <ul v-else class="plugin-notification-list">
      <li v-for="record in notifications" :key="record.item.id" :class="{ read: record.read }">
        <div class="plugin-notification-copy">
          <strong>{{ notificationSource(record) }}</strong>
          <time>{{ notificationTime(record.item.createdAt) }}</time>
          <span>{{ record.item.title }} · {{ record.item.body }}</span>
        </div>
        <div class="plugin-notification-actions">
          <Button v-if="record.item.link" variant="ghost" size="sm" @click="openNotificationLink(record.item.id)">
            {{ t('pluginFeedOpenLink') }}
          </Button>
          <Button v-if="!record.read" variant="secondary" size="sm" @click="markNotificationRead(record.item.id)">
            {{ t('pluginMarkRead') }}
          </Button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped src="./plugin-panel-shared.css"></style>
