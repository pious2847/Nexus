/**
 * Community focal-point fan-out on publish, against a real DB. Uses injected
 * senders so the "delivered" path is verifiable without live Arkesel/Gmail
 * credentials. Mirrors alerts.sms.integration.test.ts. Skipped by default;
 * run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> JWT_SECRET=test pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { HazardService } from '../../hazards/hazards.service';
import { RbacService } from '../../../core/rbac/rbac.service';
import { GeographyService } from '../../../core/geography/geography.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { AlertsService } from '../alerts.service';
import { FocalPointService } from './focal-point.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('Community focal-point fan-out on publish (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let geography: GeographyService;
  let focalPoints: FocalPointService;
  let districtId = '';
  let adminId = '';
  let eventId = '';
  let radioPointId = '';
  const warningIds: string[] = [];
  const smsSentTo: { to: string; message: string }[] = [];
  const emailSentTo: { to: string; subject: string }[] = [];
  const fakeSms = async (to: string, message: string) => {
    smsSentTo.push({ to, message });
    return { sent: true, provider: 'fake' };
  };
  const fakeEmail = async (to: string, subject: string) => {
    emailSentTo.push({ to, subject });
    return { sent: true, provider: 'fake' };
  };

  beforeAll(async () => {
    conn = createDb();
    geography = new GeographyService(conn.db);
    focalPoints = new FocalPointService(conn.db, geography);

    const d = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    districtId = (d.rows[0] as { id: string }).id;
    adminId = ((await conn.db.execute(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0] as { id: string }).id;

    const radio = await focalPoints.register(
      {
        placeId: districtId, name: 'Radio Tolon FM', relayMethod: 'radio_broadcast',
        stationName: 'Tolon FM 101.5', contactPhone: '+2332947123456', contactEmail: 'newsroom@example.com',
      },
      adminId,
    );
    radioPointId = radio.id;

    const ev = await new HazardService(conn.db).raiseEvent({ hazardType: 'flood', placeId: districtId, title: 'Focal-point fan-out test', state: 'watch', severity: 'severe' });
    eventId = ev.id;
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of warningIds) await conn.db.execute(sql`DELETE FROM warnings WHERE id = ${id}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    if (radioPointId) await conn.db.execute(sql`DELETE FROM community_focal_points WHERE id = ${radioPointId}`);
    await conn.close();
  });

  it('sends the broadcast script (not the SMS/email subscriber format) to active focal points covering the area', async () => {
    const alerts = new AlertsService(
      conn.db, new RbacService(conn.db), new NotificationsService(conn.db), undefined,
      fakeSms, undefined, fakeEmail, focalPoints,
    );

    const draft = await alerts.draftFromEvent(eventId, adminId, { instruction: 'Move to higher ground.' });
    warningIds.push(draft.id);
    const published = await alerts.publish(draft.id, adminId);

    expect(published.focal_points_notified).toBe(1);
    expect(smsSentTo.some((s) => s.to === '+2332947123456' && s.message.includes('OFFICIAL NEXUS DISASTER ALERT'))).toBe(true);
    expect(emailSentTo.some((e) => e.to === 'newsroom@example.com')).toBe(true);
  });

  it('does not fan out to focal points when the service is not injected (graceful skip)', async () => {
    const alertsWithoutFocal = new AlertsService(conn.db, new RbacService(conn.db), new NotificationsService(conn.db), undefined, fakeSms, undefined, fakeEmail); // no focalPoints arg
    const draft = await alertsWithoutFocal.draftFromEvent(eventId, adminId);
    warningIds.push(draft.id);
    const published = await alertsWithoutFocal.publish(draft.id, adminId);

    expect(published.focal_points_notified).toBe(0);
  });

  it('serves a printable notice sheet for a published alert, and null for a draft', async () => {
    const alerts = new AlertsService(conn.db, new RbacService(conn.db), new NotificationsService(conn.db), undefined, fakeSms, undefined, fakeEmail, focalPoints);
    const draft = await alerts.draftFromEvent(eventId, adminId, { instruction: 'Move to higher ground.' });
    warningIds.push(draft.id);

    const draftNotice = await alerts.noticeSheetHtml(draft.id);
    expect(draftNotice).toBeNull();

    await alerts.publish(draft.id, adminId);
    const publishedNotice = await alerts.noticeSheetHtml(draft.id);
    expect(publishedNotice).toContain('<!DOCTYPE html>');
    expect(publishedNotice).toContain(draft.headline);
  });
});
