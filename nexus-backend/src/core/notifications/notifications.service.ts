/**
 * Notifications service — in-app notifications + subscription/preference
 * management. This is the storage/read side; the fan-out DELIVERY engine
 * (push/SMS/WhatsApp/voice, geo-targeting) is built in Module F on top of this.
 */
import type { NotificationChannel } from '@nexus/shared';
import type { Db } from '../../shared/db';
import * as repo from './notifications.repository';

export class NotificationsService {
  constructor(private readonly db: Db) {}

  notify(n: { userId: string; type: string; title: string; body?: string; data?: unknown }) {
    return repo.insertNotification(this.db, n);
  }

  list(userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
    return repo.listNotifications(this.db, userId, opts);
  }

  markRead(id: string, userId: string) {
    return repo.markNotificationRead(this.db, id, userId);
  }

  subscribe(userId: string, placeId: string, channels: NotificationChannel[], hazardTypes?: string[] | null) {
    return repo.upsertSubscription(this.db, { userId, placeId, channels, hazardTypes });
  }

  unsubscribe(userId: string, placeId: string) {
    return repo.removeSubscription(this.db, userId, placeId);
  }

  subscriptions(userId: string) {
    return repo.listSubscriptions(this.db, userId);
  }

  setPreference(userId: string, channel: NotificationChannel, enabled: boolean) {
    return repo.setPreference(this.db, userId, channel, enabled);
  }

  preferences(userId: string) {
    return repo.getPreferences(this.db, userId);
  }

  registerPush(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
    return repo.addPushSubscription(this.db, { userId, ...sub });
  }

  unregisterPush(endpoint: string) {
    return repo.removePushSubscription(this.db, endpoint);
  }
}
