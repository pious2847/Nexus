/**
 * SMS citizen-reporting orchestration against a real DB: parse → resolve
 * district → submit report → confirmation SMS. Uses an injected SMS sender so
 * the whole flow is deterministic without a live Arkesel key. Skipped by
 * default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { GeographyService } from '../../../core/geography/geography.service';
import { HazardService } from '../../hazards/hazards.service';
import { ReportsService } from '../reports.service';
import { handleInboundSmsReport } from './report-sms.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('SMS citizen reporting (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let reports: ReportsService;
  let geography: GeographyService;
  const sentTo: { to: string; message: string }[] = [];
  const fakeSendSms = async (to: string, message: string) => {
    sentTo.push({ to, message });
    return { sent: true, provider: 'fake' };
  };
  const reportIds: string[] = [];

  beforeAll(() => {
    conn = createDb();
    geography = new GeographyService(conn.db);
    reports = new ReportsService(conn.db, geography, new HazardService(conn.db));
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of reportIds) await conn.db.execute(sql`DELETE FROM incident_reports WHERE id = ${id}`);
    await conn.close();
  });

  it('parses a well-formed report, resolves the district (fuzzy match), and submits it', async () => {
    const from = '+233201234567';
    const result = await handleInboundSmsReport(
      { reports, geography, sendSms: fakeSendSms },
      from,
      'REPORT FLOOD, Sagnarigu, Water is entering the school compound', // "Sagnarigu" vs actual "Sagnerigu" — fuzzy match
    );
    expect(result.handled).toBe(true);
    expect(result.placeResolved).toBe(true);
    reportIds.push(result.reportId as string);

    const report = await reports.getReport(result.reportId as string);
    expect(report?.hazard_type).toBe('flood');
    expect(report?.reporter_phone).toBe(from);
    expect(report?.place_id).toBeTruthy();
    expect(report?.source).toBe('sms');

    expect(sentTo).toHaveLength(1);
    expect(sentTo[0].to).toBe(from);
    expect(sentTo[0].message).toContain('Thank you');
  });

  it('still submits the report when the place cannot be resolved, and says so in the reply', async () => {
    const from = '+233209999999';
    const result = await handleInboundSmsReport(
      { reports, geography, sendSms: fakeSendSms },
      from,
      'REPORT FIRE, Atlantis, Smoke visible over the hill',
    );
    expect(result.handled).toBe(true);
    expect(result.placeResolved).toBe(false);
    reportIds.push(result.reportId as string);

    const report = await reports.getReport(result.reportId as string);
    expect(report?.hazard_type).toBe('bushfire');
    expect(report?.place_id).toBeNull();

    const lastSms = sentTo[sentTo.length - 1];
    expect(lastSms.message).toContain('location not recognized');
  });

  it('replies with help text and does not create a report for a malformed message', async () => {
    const from = '+233207777777';
    const result = await handleInboundSmsReport({ reports, geography, sendSms: fakeSendSms }, from, 'hello there');
    expect(result.handled).toBe(false);
    expect(result.reportId).toBeUndefined();
    const lastSms = sentTo[sentTo.length - 1];
    expect(lastSms.to).toBe(from);
    expect(lastSms.message).toContain('REPORT <type>, <place>, <description>');
  });
});
