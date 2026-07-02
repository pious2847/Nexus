/**
 * Notifications storage layer against a real DB. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { NotificationsService } from './notifications.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('notifications (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let svc: NotificationsService;
  const phone = `+23327${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  let userId = '';
  let placeId = '';

  beforeAll(async () => {
    conn = createDb();
    svc = new NotificationsService(conn.db);
    const u = await conn.db.execute(
      sql`INSERT INTO users (name, phone, role, status) VALUES (${phone}, ${phone}, 'citizen', 'active') RETURNING id`,
    );
    userId = (u.rows[0] as { id: string }).id;
    const p = await conn.db.execute(sql`SELECT id FROM places WHERE level = 'region' AND name = 'Northern' LIMIT 1`);
    placeId = (p.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    if (!conn) return;
    if (userId) await conn.db.execute(sql`DELETE FROM users WHERE id = ${userId}`); // cascades
    await conn.close();
  });

  it('creates, lists, and marks notifications read', async () => {
    const { id } = await svc.notify({ userId, type: 'alert', title: 'Flood warning', body: 'Move to high ground' });
    let unread = await svc.list(userId, { unreadOnly: true });
    expect(unread.some((n) => n.id === id)).toBe(true);

    await svc.markRead(id, userId);
    unread = await svc.list(userId, { unreadOnly: true });
    expect(unread.some((n) => n.id === id)).toBe(false);
  });

  it('manages subscriptions and channel preferences', async () => {
    await svc.subscribe(userId, placeId, ['in_app', 'sms'], ['flood']);
    const subs = await svc.subscriptions(userId);
    const sub = subs.find((s) => s.place_id === placeId);
    expect(sub?.channels).toEqual(['in_app', 'sms']);
    expect(sub?.hazard_types).toEqual(['flood']);

    await svc.setPreference(userId, 'push', true);
    await svc.setPreference(userId, 'sms', false);
    const prefs = await svc.preferences(userId);
    expect(prefs.find((p) => p.channel === 'push')?.enabled).toBe(true);
    expect(prefs.find((p) => p.channel === 'sms')?.enabled).toBe(false);
  });

  it('registers and unregisters web-push endpoints', async () => {
    const endpoint = `https://push.example/${userId}`;
    await svc.registerPush(userId, { endpoint, p256dh: 'key', auth: 'secret' });
    let n = await conn.db.execute(sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = ${endpoint}`);
    expect((n.rows[0] as { n: number }).n).toBe(1);

    await svc.unregisterPush(endpoint);
    n = await conn.db.execute(sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = ${endpoint}`);
    expect((n.rows[0] as { n: number }).n).toBe(0);
  });
});
