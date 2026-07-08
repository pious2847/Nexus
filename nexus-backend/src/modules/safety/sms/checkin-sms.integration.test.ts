/**
 * SMS check-in orchestration against a real DB: parse -> resolve district ->
 * record check-in (auto-linked to an open hazard event if one covers the
 * place) -> confirmation SMS. Uses an injected SMS sender so the whole flow
 * is deterministic without a live Arkesel key. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { GeographyService } from '../../../core/geography/geography.service';
import { HazardService } from '../../hazards/hazards.service';
import { SafetyCheckinService } from '../checkin.service';
import { handleInboundSmsCheckin } from './checkin-sms.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('SMS "I\'m Safe" check-in (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let checkins: SafetyCheckinService;
  let geography: GeographyService;
  let hazards: HazardService;
  let tolonId = '';
  let eventId = '';
  const sentTo: { to: string; message: string }[] = [];
  const fakeSendSms = async (to: string, message: string) => {
    sentTo.push({ to, message });
    return { sent: true, provider: 'fake' };
  };
  const checkinIds: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    geography = new GeographyService(conn.db);
    hazards = new HazardService(conn.db);
    checkins = new SafetyCheckinService(conn.db, geography);

    const d = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    tolonId = (d.rows[0] as { id: string }).id;
    const event = await hazards.raiseEvent({ hazardType: 'flood', placeId: tolonId, title: 'Check-in SMS test event', state: 'watch', severity: 'severe' });
    eventId = event.id;
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of checkinIds) await conn.db.execute(sql`DELETE FROM safety_checkins WHERE id = ${id}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    await conn.close();
  });

  it('parses a self check-in with fuzzy place matching, auto-links it to the open event covering that exact place', async () => {
    const from = '+233201025963';
    // "Tolon" itself (not a fuzzy neighbor) so the auto-link to the Tolon-scoped event is unambiguous.
    const result = await handleInboundSmsCheckin({ checkins, geography, sendSms: fakeSendSms }, from, 'SAFE, Tolon');
    expect(result.handled).toBe(true);
    checkinIds.push(result.checkinId as string);

    const row = await checkinRow(conn, result.checkinId as string);
    expect(row.status).toBe('safe');
    expect(row.hazard_event_id).toBe(eventId);

    expect(sentTo).toHaveLength(1);
    expect(sentTo[0].message).toContain('You marked SAFE');
  });

  it('parses an on-behalf-of check-in from a community focal person', async () => {
    const from = '+233202222222';
    const result = await handleInboundSmsCheckin({ checkins, geography, sendSms: fakeSendSms }, from, 'HELP, Tolon, Ama Yeboah');
    expect(result.handled).toBe(true);
    checkinIds.push(result.checkinId as string);

    const row = await checkinRow(conn, result.checkinId as string);
    expect(row.status).toBe('need_help');
    expect(row.subject_name).toBe('Ama Yeboah');
    expect(row.reporter_phone).toBe(from);
    expect(row.hazard_event_id).toBe(eventId); // Tolon exactly matches the event's place

    const lastSms = sentTo[sentTo.length - 1];
    expect(lastSms.message).toContain('Ama Yeboah marked as NEEDING HELP');
  });

  it('asks the sender to retry when the place cannot be resolved (does not record a place-less check-in)', async () => {
    const from = '+233203333333';
    const result = await handleInboundSmsCheckin({ checkins, geography, sendSms: fakeSendSms }, from, 'SAFE, Atlantis');
    expect(result.handled).toBe(false);
    expect(result.checkinId).toBeUndefined();
    const lastSms = sentTo[sentTo.length - 1];
    expect(lastSms.message).toContain('Could not recognize');
  });

  it('replies with help text and does not create a check-in for a malformed message', async () => {
    const from = '+233204444444';
    const result = await handleInboundSmsCheckin({ checkins, geography, sendSms: fakeSendSms }, from, 'hello there');
    expect(result.handled).toBe(false);
    expect(result.checkinId).toBeUndefined();
    const lastSms = sentTo[sentTo.length - 1];
    expect(lastSms.message).toContain('SAFE, <place>');
  });
});

async function checkinRow(conn: ReturnType<typeof createDb>, id: string) {
  const r = await conn.db.execute(sql`SELECT * FROM safety_checkins WHERE id = ${id}`);
  return r.rows[0] as { status: string; subject_name: string | null; reporter_phone: string | null; hazard_event_id: string | null };
}
