import { Notification } from 'electron'
import type { DesktopPreferences } from '../src/types/desktop'
import type { AgentStatusEvent } from './event-server'
import { readBoundedJson, writeJsonAtomic } from './desktop-preferences'
import {
  aggregateTerminalNotifications,
  classifyNotification,
  NotificationCooldown,
  type NotificationCandidate,
  type NotificationKind,
} from './notification-policy'

type NotificationOutcome =
  | 'shown'
  | 'clicked'
  | 'suppressed-cooldown'
  | 'suppressed-dnd'
  | 'suppressed-disabled'
  | 'suppressed-foreground'
  | 'unsupported'

interface NotificationLogRecord {
  at: number
  kind: NotificationKind
  outcome: NotificationOutcome
  count: number
}

interface DesktopNotificationServiceOptions {
  logFilePath: string
  getPreferences: () => DesktopPreferences
  isAppFocused: () => boolean
  onNotificationClick: () => void
  onAttentionChanged: (count: number) => void
  batchWindowMs?: number
}

const MAX_LOG_RECORDS = 200

export class DesktopNotificationService {
  private readonly options: DesktopNotificationServiceOptions
  private readonly cooldown = new NotificationCooldown()
  private readonly terminalQueue = new Map<string, NotificationCandidate>()
  private readonly batchWindowMs: number
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private attentionCount = 0

  constructor(options: DesktopNotificationServiceOptions) {
    this.options = options
    this.batchWindowMs = options.batchWindowMs ?? 10_000
  }

  handleEvent(event: AgentStatusEvent): void {
    const candidate = classifyNotification(event)
    if (!candidate) return

    if (!this.cooldown.take(candidate.key)) {
      this.log(candidate.kind, 'suppressed-cooldown')
      return
    }

    this.attentionCount += 1
    this.options.onAttentionChanged(this.attentionCount)

    if (candidate.terminal) {
      this.terminalQueue.set(candidate.key, candidate)
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushTerminalQueue(), this.batchWindowMs)
      }
      return
    }

    this.deliver(candidate.title, candidate.body, candidate.kind, 1)
  }

  clearAttention(): void {
    if (this.attentionCount === 0) return
    this.attentionCount = 0
    this.options.onAttentionChanged(0)
  }

  destroy(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer)
    this.batchTimer = null
    this.terminalQueue.clear()
  }

  private flushTerminalQueue(): void {
    this.batchTimer = null
    const candidates = [...this.terminalQueue.values()]
    this.terminalQueue.clear()
    if (candidates.length === 0) return

    const message = aggregateTerminalNotifications(candidates)
    this.deliver(message.title, message.body, candidates[0].kind, candidates.length)
  }

  private deliver(
    title: string,
    body: string,
    kind: NotificationKind,
    count: number,
  ): void {
    const preferences = this.options.getPreferences()
    if (!preferences.notificationsEnabled) {
      this.log(kind, 'suppressed-disabled', count)
      return
    }
    if (preferences.dndEnabled) {
      this.log(kind, 'suppressed-dnd', count)
      return
    }
    if (this.options.isAppFocused()) {
      this.log(kind, 'suppressed-foreground', count)
      return
    }
    if (!Notification.isSupported()) {
      this.log(kind, 'unsupported', count)
      return
    }

    try {
      const notification = new Notification({ title, body, silent: true })
      notification.on('click', () => {
        this.log(kind, 'clicked', count)
        this.clearAttention()
        this.options.onNotificationClick()
      })
      notification.show()
      this.log(kind, 'shown', count)
    } catch {
      this.log(kind, 'unsupported', count)
    }
  }

  private log(kind: NotificationKind, outcome: NotificationOutcome, count = 1): void {
    const existing = readBoundedJson(this.options.logFilePath)
    const records = Array.isArray(existing)
      ? existing.filter((record): record is NotificationLogRecord => (
          Boolean(record)
          && typeof record === 'object'
          && typeof record.at === 'number'
          && typeof record.kind === 'string'
          && typeof record.outcome === 'string'
          && typeof record.count === 'number'
        ))
      : []
    records.push({ at: Date.now(), kind, outcome, count })
    try {
      writeJsonAtomic(this.options.logFilePath, records.slice(-MAX_LOG_RECORDS))
    } catch {
      // Notification logging is diagnostic only. A read-only/corrupt userData
      // directory must never break event ingestion or Agent state updates.
    }
  }
}
