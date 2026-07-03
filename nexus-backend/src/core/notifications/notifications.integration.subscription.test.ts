/**
 * End-to-end proof that the subscription -> warning -> inbox loop actually
 * closes: a citizen subscribes to a district, a warning is published for the
 * parent region, and the citizen's in-app inbox receives it. Skipped by
 * default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> JWT_SECRET=test pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { NotificationsService } from './notifications.service';
import { HazardService } from '../../modules/hazards/hazards.service';
import { RbacService } from '../rbac/rbac.service';
import { AlertsService } from '../../modules/alerts/alerts.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('subscription -> warning -> inbox (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let notifications: NotificationsService;
  let alerts: AlertsService;
  let hazards: HazardService;
  let regionId = '';
  let districtId = '';
  let citizenId = '';
  let adminId = '';
  let eventId = '';
  let warningId = '';

  beforeAll(async () => {
    conn = createDb();
    notifications = new NotificationsService(conn.db);
    hazards = new HazardService(conn.db);
    alerts = new AlertsService(conn.db, new RbacService(conn.db), notifications);

    const r = await conn.db.execute(sql`SELECT id FROM places WHERE level='region' AND name='Northern' LIMIT 1`);
    regionId = (r.rows[0] as { id: string }).id;
    const d = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    districtId = (d.rows[0] as { id: string }).id;
    adminId = ((await conn.db.execute(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0] as { id: string }).id;

    const phone = `+2332955${Math.floor(Math.random() * 899999 + 100000)}`;
    citizenId = ((await conn.db.execute(
      sql`INSERT INTO users (name, phone, role, status) VALUES ('Sub Citizen', ${phone}, 'citizen', 'active') RETURNING id`,
    )).rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    if (!conn) return;
    if (warningId) await conn.db.execute(sql`DELETE FROM warnings WHERE id = ${warningId}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    if (citizenId) await conn.db.execute(sql`DELETE FROM users WHERE id = ${citizenId}`); // cascades subs/notifs
    await conn.close();
  });

  it('subscribes a citizen to a district (their own data)', async () => {
    await notifications.subscribe(citizenId, districtId, ['in_app']);
    const subs = await notifications.subscriptions(citizenId);
    expect(subs).toHaveLength(1);
    expect(subs[0].place_id).toBe(districtId);
    expect(subs[0].channels).toEqual(['in_app']);
  });

  it('publishing a region-level warning notifies the district subscriber, who can read it', async () => {
    const event = await hazards.raiseEvent({ hazardType: 'flood', placeId: regionId, title: 'Sub test flood', state: 'watch', severity: 'severe' });
    eventId = event.id;
    const draft = await alerts.draftFromEvent(eventId, adminId);
    warningId = draft.id;
    const published = await alerts.publish(warningId, adminId); // super_admin: national scope
    expect(published.recipients).toBeGreaterThanOrEqual(1);

    const inbox = await notifications.list(citizenId, { unreadOnly: true });
    expect(inbox.length).toBeGreaterThanOrEqual(1);
    const notif = inbox.find((n) => (n.data as { alertId?: string })?.alertId === warningId);
    expect(notif).toBeTruthy();

    await notifications.markRead(notif!.id, citizenId);
    const unreadAfter = await notifications.list(citizenId, { unreadOnly: true });
    expect(unreadAfter.find((n) => n.id === notif!.id)).toBeUndefined();
  });

  it('unsubscribing removes the district from the citizen\'s subscriptions', async () => {
    await notifications.unsubscribe(citizenId, districtId);
    const subs = await notifications.subscriptions(citizenId);
    expect(subs).toHaveLength(0);
  });
});
