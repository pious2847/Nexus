/**
 * Alert dissemination against a real DB: draft from event → tiered publish →
 * subscriber notification. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> JWT_SECRET=test pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { HazardService } from '../hazards/hazards.service';
import { RbacService } from '../../core/rbac/rbac.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { AlertsService, PublishForbiddenError } from './alerts.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('alert dissemination (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let alerts: AlertsService;
  let hazards: HazardService;
  let regionId = '';
  let districtId = '';
  let adminId = '';
  let officerId = ''; // district_officer @ Northern — can publish advisory/watch, NOT severe
  let coordId = ''; // regional_coordinator @ Northern — can publish up to severe, NOT extreme
  let subscriberId = '';
  let eventId = '';
  const alertIds: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    hazards = new HazardService(conn.db);
    alerts = new AlertsService(conn.db, new RbacService(conn.db), new NotificationsService(conn.db));

    const nr = await conn.db.execute(sql`SELECT id, path::text AS path FROM places WHERE level='region' AND name='Northern' LIMIT 1`);
    regionId = (nr.rows[0] as { id: string }).id;
    const dd = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    districtId = (dd.rows[0] as { id: string }).id;
    adminId = ((await conn.db.execute(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0] as { id: string }).id;

    // a district officer scoped to Northern (advisory/watch only — cannot publish severe)
    const ph = `+2332977${Math.floor(Math.random() * 899999 + 100000)}`;
    officerId = ((await conn.db.execute(sql`INSERT INTO users (name, phone, role, status) VALUES ('Officer', ${ph}, 'district_officer','active') RETURNING id`)).rows[0] as { id: string }).id;
    await conn.db.execute(sql`INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${officerId}, 'district_officer', ${regionId})`);

    // a regional coordinator scoped to Northern (can publish up to severe, not extreme)
    const phc = `+2332966${Math.floor(Math.random() * 899999 + 100000)}`;
    coordId = ((await conn.db.execute(sql`INSERT INTO users (name, phone, role, status) VALUES ('Coordinator', ${phc}, 'district_officer','active') RETURNING id`)).rows[0] as { id: string }).id;
    await conn.db.execute(sql`INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${coordId}, 'regional_coordinator', ${regionId})`);

    // a citizen subscribed to the Tolon district (should receive the Northern-region alert)
    const ph2 = `+2332988${Math.floor(Math.random() * 899999 + 100000)}`;
    subscriberId = ((await conn.db.execute(sql`INSERT INTO users (name, phone, role, status) VALUES ('Citizen', ${ph2}, 'citizen','active') RETURNING id`)).rows[0] as { id: string }).id;
    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${subscriberId}, ${districtId}, ARRAY['in_app']::text[])`);

    const ev = await hazards.raiseEvent({ hazardType: 'flood', placeId: regionId, title: 'Flood — Northern', state: 'watch', severity: 'severe' });
    eventId = ev.id;
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of alertIds) await conn.db.execute(sql`DELETE FROM warnings WHERE id = ${id}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    await conn.db.execute(sql`DELETE FROM users WHERE id IN (${officerId}, ${coordId}, ${subscriberId})`); // cascades subs/notifs
    await conn.close();
  });

  it('drafts a CAP alert from a hazard event', async () => {
    const alert = await alerts.draftFromEvent(eventId, adminId);
    alertIds.push(alert.id);
    expect(alert.status).toBe('draft');
    expect(alert.severity).toBe('severe');
    expect(alert.category).toBe('Met');
    expect(alerts.toCap(alert).info.severity).toBe('Severe');
  });

  it('enforces tiered authority by severity and scope', async () => {
    // A district officer CANNOT publish a severe warning.
    const s1 = await alerts.draftFromEvent(eventId, adminId);
    alertIds.push(s1.id);
    await expect(alerts.publish(s1.id, officerId)).rejects.toBeInstanceOf(PublishForbiddenError);

    // A regional coordinator (scoped to Northern) CAN publish severe → notifies subscribers.
    const s2 = await alerts.draftFromEvent(eventId, adminId);
    alertIds.push(s2.id);
    const published = await alerts.publish(s2.id, coordId);
    expect(published.status).toBe('published');
    expect(published.recipients).toBeGreaterThanOrEqual(1); // the subscribed citizen

    // ...but the coordinator CANNOT publish an extreme warning (national-agency tier).
    const extremeEvent = await hazards.raiseEvent({ hazardType: 'flood', placeId: regionId, title: 'Extreme', state: 'watch', severity: 'extreme' });
    const extreme = await alerts.draftFromEvent(extremeEvent.id, adminId);
    alertIds.push(extreme.id);
    await expect(alerts.publish(extreme.id, coordId)).rejects.toBeInstanceOf(PublishForbiddenError);
    await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${extremeEvent.id}`);
  });

  it('notifies subscribers of the affected area on publish', async () => {
    const n = await conn.db.execute(sql`SELECT count(*)::int AS c FROM notifications WHERE user_id = ${subscriberId} AND type = 'alert'`);
    expect((n.rows[0] as { c: number }).c).toBeGreaterThanOrEqual(1);
  });
});
