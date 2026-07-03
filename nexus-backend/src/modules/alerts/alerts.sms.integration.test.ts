/**
 * SMS fan-out on publish, against a real DB. Uses an injected SMS sender so the
 * "delivered" path is verifiable without a live Arkesel key. Skipped by
 * default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> JWT_SECRET=test pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { HazardService } from '../hazards/hazards.service';
import { RbacService } from '../../core/rbac/rbac.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { AlertsService } from './alerts.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('SMS fan-out on publish (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let regionId = '';
  let districtId = '';
  let adminId = '';
  let smsUserA = '';
  let smsUserB = ''; // opted out of sms
  let inAppOnlyUser = '';
  let eventId = '';
  const warningIds: string[] = [];
  const sentTo: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    const r = await conn.db.execute(sql`SELECT id FROM places WHERE level='region' AND name='Northern' LIMIT 1`);
    regionId = (r.rows[0] as { id: string }).id;
    const d = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    districtId = (d.rows[0] as { id: string }).id;
    adminId = ((await conn.db.execute(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0] as { id: string }).id;

    const mk = async (label: string) => {
      const phone = `+2332944${Math.floor(Math.random() * 899999 + 100000)}`;
      const u = await conn.db.execute(sql`INSERT INTO users (name, phone, role, status) VALUES (${label}, ${phone}, 'citizen', 'active') RETURNING id`);
      return (u.rows[0] as { id: string }).id;
    };
    smsUserA = await mk('SMS Subscriber A');
    smsUserB = await mk('SMS Subscriber B (opted out)');
    inAppOnlyUser = await mk('In-app only');

    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${smsUserA}, ${districtId}, ARRAY['in_app','sms']::text[])`);
    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${smsUserB}, ${districtId}, ARRAY['in_app','sms']::text[])`);
    await conn.db.execute(sql`INSERT INTO notification_preferences (user_id, channel, enabled) VALUES (${smsUserB}, 'sms', false)`);
    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${inAppOnlyUser}, ${districtId}, ARRAY['in_app']::text[])`);

    const ev = await new HazardService(conn.db).raiseEvent({ hazardType: 'flood', placeId: regionId, title: 'SMS fan-out test', state: 'watch', severity: 'severe' });
    eventId = ev.id;
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of warningIds) await conn.db.execute(sql`DELETE FROM warnings WHERE id = ${id}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    await conn.db.execute(sql`DELETE FROM users WHERE id IN (${smsUserA}, ${smsUserB}, ${inAppOnlyUser})`);
    await conn.close();
  });

  it('attempts SMS only for opted-in subscribers with a phone, and records delivered via the injected sender', async () => {
    const fakeSender = async (to: string) => {
      sentTo.push(to);
      return { sent: true, provider: 'fake' };
    };
    const alerts = new AlertsService(conn.db, new RbacService(conn.db), new NotificationsService(conn.db), undefined, fakeSender);

    const draft = await alerts.draftFromEvent(eventId, adminId, { instruction: 'Evacuate low-lying areas.' });
    warningIds.push(draft.id);
    const published = await alerts.publish(draft.id, adminId);

    expect(published.sms_attempted).toBe(1); // only smsUserA: smsUserB opted out, inAppOnlyUser has no sms channel
    expect(published.sms_delivered).toBe(1);
    expect(published.recipients).toBe(3); // all three are in_app subscribers
    expect(sentTo).toHaveLength(1);
  });

  it('falls back to the real Arkesel adapter (dev/no-key mode: attempted but not delivered)', async () => {
    const alerts = new AlertsService(conn.db, new RbacService(conn.db), new NotificationsService(conn.db)); // default sender
    const draft = await alerts.draftFromEvent(eventId, adminId);
    warningIds.push(draft.id);
    const published = await alerts.publish(draft.id, adminId);

    expect(published.sms_attempted).toBe(1);
    expect(published.sms_delivered).toBe(0); // no ARKESEL_API_KEY in test env -> sent:false
  });
});
