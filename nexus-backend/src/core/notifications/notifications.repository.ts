/**
 * Data access for in-app notifications, alert subscriptions, per-channel
 * preferences, and web-push endpoints. The multi-channel DELIVERY engine
 * (SMS/WhatsApp/push/voice fan-out) is Module F; this is the storage layer.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';
import type { NotificationChannel } from '@nexus/shared';

/**
 * Build a `text[]` SQL fragment from a JS array. Needed because drizzle expands
 * a bare array param into a tuple `($1,$2)`, which can't be cast to text[].
 */
function textArray(values: string[] | null | undefined) {
  if (values == null) return sql`NULL`;
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  read_at: string | null;
  created_at: string;
}

export async function insertNotification(
  db: Db,
  n: { userId: string; type: string; title: string; body?: string; data?: unknown },
): Promise<{ id: string }> {
  const r = await db.execute(sql`
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (${n.userId}, ${n.type}, ${n.title}, ${n.body ?? null}, ${JSON.stringify(n.data ?? {})}::jsonb)
    RETURNING id
  `);
  return r.rows[0] as unknown as { id: string };
}

export async function listNotifications(
  db: Db,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationRow[]> {
  const unread = opts.unreadOnly ? sql` AND read_at IS NULL` : sql``;
  const r = await db.execute(sql`
    SELECT id, type, title, body, data, read_at, created_at
    FROM notifications WHERE user_id = ${userId}${unread}
    ORDER BY created_at DESC LIMIT ${opts.limit ?? 50}
  `);
  return r.rows as unknown as NotificationRow[];
}

export async function markNotificationRead(db: Db, id: string, userId: string): Promise<void> {
  await db.execute(sql`UPDATE notifications SET read_at = now() WHERE id = ${id} AND user_id = ${userId} AND read_at IS NULL`);
}

// ── Subscriptions ────────────────────────────────────────────────────────────
export async function upsertSubscription(
  db: Db,
  s: { userId: string; placeId: string; channels: NotificationChannel[]; hazardTypes?: string[] | null },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO subscriptions (user_id, place_id, channels, hazard_types)
    VALUES (${s.userId}, ${s.placeId}, ${textArray(s.channels)}, ${textArray(s.hazardTypes ?? null)})
    ON CONFLICT (user_id, place_id)
    DO UPDATE SET channels = EXCLUDED.channels, hazard_types = EXCLUDED.hazard_types
  `);
}

export async function removeSubscription(db: Db, userId: string, placeId: string): Promise<void> {
  await db.execute(sql`DELETE FROM subscriptions WHERE user_id = ${userId} AND place_id = ${placeId}`);
}

export async function listSubscriptions(db: Db, userId: string) {
  const r = await db.execute(sql`
    SELECT place_id, channels, hazard_types FROM subscriptions WHERE user_id = ${userId}
  `);
  return r.rows as unknown as { place_id: string; channels: string[]; hazard_types: string[] | null }[];
}

// ── Preferences ──────────────────────────────────────────────────────────────
export async function setPreference(db: Db, userId: string, channel: NotificationChannel, enabled: boolean): Promise<void> {
  await db.execute(sql`
    INSERT INTO notification_preferences (user_id, channel, enabled) VALUES (${userId}, ${channel}, ${enabled})
    ON CONFLICT (user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled
  `);
}

export async function getPreferences(db: Db, userId: string) {
  const r = await db.execute(sql`SELECT channel, enabled FROM notification_preferences WHERE user_id = ${userId}`);
  return r.rows as unknown as { channel: string; enabled: boolean }[];
}

// ── Web-push ─────────────────────────────────────────────────────────────────
export async function addPushSubscription(
  db: Db,
  p: { userId: string; endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${p.userId}, ${p.endpoint}, ${p.p256dh}, ${p.auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `);
}

export async function removePushSubscription(db: Db, endpoint: string): Promise<void> {
  await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
}
