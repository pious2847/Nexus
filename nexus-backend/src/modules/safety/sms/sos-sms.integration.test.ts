/**
 * SMS SOS orchestration against a real DB: parse -> resolve district ->
 * resolve centroid -> raise the SOS (which fans out to responders) ->
 * confirmation SMS. Uses injected senders so the whole flow is
 * deterministic without live Arkesel credentials. Skipped by default; run
 * with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { GeographyService } from '../../../core/geography/geography.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { SosService } from '../sos.service';
import { handleInboundSmsSos } from './sos-sms.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('SMS SOS (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let geography: GeographyService;
  let sosService: SosService;
  let districtOfficerId = '';
  let districtOfficerPhone = '';
  const sosSentTo: { to: string; message: string }[] = [];
  const fakeResponderSms = async (to: string, message: string) => {
    sosSentTo.push({ to, message });
    return { sent: true, provider: 'fake' };
  };
  const confirmSentTo: { to: string; message: string }[] = [];
  const fakeConfirmSms = async (to: string, message: string) => {
    confirmSentTo.push({ to, message });
    return { sent: true, provider: 'fake' };
  };
  const sosIds: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    geography = new GeographyService(conn.db);
    sosService = new SosService(conn.db, geography, new NotificationsService(conn.db), undefined, fakeResponderSms);

    const tolon = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    const tolonId = (tolon.rows[0] as { id: string }).id;
    districtOfficerPhone = `+2332946${Math.floor(Math.random() * 899999 + 100000)}`;
    const u = await conn.db.execute(
      sql`INSERT INTO users (name, phone, role, status) VALUES ('SOS Test District Officer', ${districtOfficerPhone}, 'district_officer', 'active') RETURNING id`,
    );
    districtOfficerId = (u.rows[0] as { id: string }).id;
    await conn.db.execute(sql`INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${districtOfficerId}, 'district_officer', ${tolonId})`);
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of sosIds) await conn.db.execute(sql`DELETE FROM sos_alerts WHERE id = ${id}`);
    if (districtOfficerId) {
      await conn.db.execute(sql`DELETE FROM user_roles WHERE user_id = ${districtOfficerId}`);
      await conn.db.execute(sql`DELETE FROM users WHERE id = ${districtOfficerId}`);
    }
    await conn.close();
  });

  it('parses a well-formed SOS, resolves a district centroid, raises the alert, and notifies the geo-scoped district officer', async () => {
    const from = '+233201555555';
    const result = await handleInboundSmsSos({ sos: sosService, geography, sendSms: fakeConfirmSms }, from, 'SOS, Tolon, Trapped by flood water');
    expect(result.handled).toBe(true);
    sosIds.push(result.sosId as string);

    const alert = await sosService.getSos(result.sosId as string);
    expect(alert?.status).toBe('open');
    expect(alert?.location_precision).toBe('district_centroid');
    expect(alert?.reporter_phone).toBe(from);
    expect(alert?.notes).toBe('Trapped by flood water');
    // This runs against a shared dev DB with real seed officers/admins (e.g. a
    // national-scoped super_admin) who legitimately also get notified — assert our
    // seeded district officer was among the recipients, not an exact total count.
    expect(alert?.responders_notified ?? 0).toBeGreaterThanOrEqual(1);
    expect(sosSentTo.length).toBeGreaterThanOrEqual(1);
    expect(sosSentTo.every((s) => s.message.includes('SOS'))).toBe(true);
    expect(sosSentTo.some((s) => s.to === districtOfficerPhone)).toBe(true); // our seeded officer was specifically notified

    expect(confirmSentTo).toHaveLength(1); // the confirmation back to the original sender
    expect(confirmSentTo[0].to).toBe(from);
    expect(confirmSentTo[0].message).toContain('Responders have been alerted');
  });

  it('asks the sender to retry when the place cannot be resolved (does not record a location-less SOS)', async () => {
    const from = '+233201666666';
    const result = await handleInboundSmsSos({ sos: sosService, geography, sendSms: fakeConfirmSms }, from, 'SOS, Atlantis, help');
    expect(result.handled).toBe(false);
    expect(result.sosId).toBeUndefined();
    const lastSms = confirmSentTo[confirmSentTo.length - 1];
    expect(lastSms.message).toContain('EMERGENCY');
  });

  it('replies with help text for a malformed message', async () => {
    const from = '+233201777777';
    const result = await handleInboundSmsSos({ sos: sosService, geography, sendSms: fakeConfirmSms }, from, 'hello there');
    expect(result.handled).toBe(false);
    const lastSms = confirmSentTo[confirmSentTo.length - 1];
    expect(lastSms.message).toContain('SOS, <place>, <what is happening>');
  });
});
