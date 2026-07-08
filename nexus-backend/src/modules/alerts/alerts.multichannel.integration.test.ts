/**
 * WhatsApp + email fan-out on publish, against a real DB. Uses injected
 * senders so the "delivered" path is verifiable without live WhatsApp/Gmail
 * credentials. Mirrors alerts.sms.integration.test.ts. Skipped by default;
 * run with:
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

describe.runIf(RUN)('WhatsApp + email fan-out on publish (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let regionId = '';
  let districtId = '';
  let adminId = '';
  let waUser = '';
  let waOptOutUser = '';
  let emailUser = '';
  let noChannelUser = '';
  let eventId = '';
  const warningIds: string[] = [];
  const waSentTo: string[] = [];
  const emailSentTo: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    const r = await conn.db.execute(sql`SELECT id FROM places WHERE level='region' AND name='Northern' LIMIT 1`);
    regionId = (r.rows[0] as { id: string }).id;
    const d = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    districtId = (d.rows[0] as { id: string }).id;
    adminId = ((await conn.db.execute(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0] as { id: string }).id;

    const mk = async (label: string, email: string | null) => {
      const phone = `+2332945${Math.floor(Math.random() * 899999 + 100000)}`;
      const u = await conn.db.execute(
        sql`INSERT INTO users (name, phone, email, role, status) VALUES (${label}, ${phone}, ${email}, 'citizen', 'active') RETURNING id`,
      );
      return (u.rows[0] as { id: string }).id;
    };
    waUser = await mk('WhatsApp Subscriber', null);
    waOptOutUser = await mk('WhatsApp Subscriber (opted out)', null);
    emailUser = await mk('Email Subscriber', `nexus-test-${Date.now()}@example.com`);
    noChannelUser = await mk('No multichannel opt-in', `nexus-test-none-${Date.now()}@example.com`);

    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${waUser}, ${districtId}, ARRAY['in_app','whatsapp']::text[])`);
    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${waOptOutUser}, ${districtId}, ARRAY['in_app','whatsapp']::text[])`);
    await conn.db.execute(sql`INSERT INTO notification_preferences (user_id, channel, enabled) VALUES (${waOptOutUser}, 'whatsapp', false)`);
    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${emailUser}, ${districtId}, ARRAY['in_app','email']::text[])`);
    await conn.db.execute(sql`INSERT INTO subscriptions (user_id, place_id, channels) VALUES (${noChannelUser}, ${districtId}, ARRAY['in_app']::text[])`);

    const ev = await new HazardService(conn.db).raiseEvent({ hazardType: 'flood', placeId: regionId, title: 'Multichannel fan-out test', state: 'watch', severity: 'severe' });
    eventId = ev.id;
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of warningIds) await conn.db.execute(sql`DELETE FROM warnings WHERE id = ${id}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    await conn.db.execute(sql`DELETE FROM users WHERE id IN (${waUser}, ${waOptOutUser}, ${emailUser}, ${noChannelUser})`);
    await conn.close();
  });

  it('attempts WhatsApp/email only for opted-in subscribers, records delivered via injected senders', async () => {
    const fakeWhatsapp = async (to: string) => {
      waSentTo.push(to);
      return { sent: true, provider: 'fake' };
    };
    const fakeEmail = async (to: string) => {
      emailSentTo.push(to);
      return { sent: true, provider: 'fake' };
    };
    const alerts = new AlertsService(
      conn.db, new RbacService(conn.db), new NotificationsService(conn.db), undefined,
      undefined, fakeWhatsapp, fakeEmail,
    );

    const draft = await alerts.draftFromEvent(eventId, adminId, { instruction: 'Evacuate low-lying areas.' });
    warningIds.push(draft.id);
    const published = await alerts.publish(draft.id, adminId);

    expect(published.whatsapp_attempted).toBe(1); // only waUser: waOptOutUser opted out, others have no whatsapp channel
    expect(published.whatsapp_delivered).toBe(1);
    expect(published.email_attempted).toBe(1); // only emailUser
    expect(published.email_delivered).toBe(1);
    expect(waSentTo).toHaveLength(1);
    expect(emailSentTo).toHaveLength(1);
  });

  it('falls back to the real adapters (dev/no-credentials mode: attempted but not delivered for WhatsApp)', async () => {
    const alerts = new AlertsService(conn.db, new RbacService(conn.db), new NotificationsService(conn.db)); // default senders
    const draft = await alerts.draftFromEvent(eventId, adminId);
    warningIds.push(draft.id);
    const published = await alerts.publish(draft.id, adminId);

    expect(published.whatsapp_attempted).toBe(1);
    expect(published.whatsapp_delivered).toBe(0); // no WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID in test env -> sent:false
    expect(published.email_attempted).toBe(1);
    // Email delivery here depends on whether GMAIL_USER/GMAIL_APP_PASSWORD are set in the
    // test environment (they are, in this repo's real .env) — don't assert a specific
    // delivered count for the real adapter path; the injected-sender test above already
    // proves the fan-out/counting logic deterministically.
  });
});
