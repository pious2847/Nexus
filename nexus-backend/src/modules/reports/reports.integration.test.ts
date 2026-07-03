/**
 * Citizen reporting flow against a real DB: submit → corroborate → verify
 * (reputation) → promote. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { GeographyService } from '../../core/geography/geography.service';
import { HazardService } from '../hazards/hazards.service';
import { ReportsService } from './reports.service';

const RUN = !!process.env.RUN_DB_TESTS;

// Two points ~a few hundred metres apart near Tamale (same district, corroborating).
const P1 = { lng: -0.8393, lat: 9.4008 };
const P2 = { lng: -0.842, lat: 9.402 };

describe.runIf(RUN)('citizen reports (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let reports: ReportsService;
  let reporterId = '';
  let reviewerId = '';
  const ids: string[] = [];
  let eventId = '';

  beforeAll(async () => {
    conn = createDb();
    reports = new ReportsService(conn.db, new GeographyService(conn.db), new HazardService(conn.db));
    const phone = `+2332999${Math.floor(Math.random() * 899999 + 100000)}`;
    const u = await conn.db.execute(
      sql`INSERT INTO users (name, phone, role, status, reputation_score) VALUES ('Reporter', ${phone}, 'citizen', 'active', 10) RETURNING id`,
    );
    reporterId = (u.rows[0] as { id: string }).id;
    const admin = await conn.db.execute(sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    reviewerId = (admin.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of ids) await conn.db.execute(sql`DELETE FROM incident_reports WHERE id = ${id}`);
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    await conn.db.execute(sql`DELETE FROM users WHERE id = ${reporterId}`);
    await conn.close();
  });

  it('submits a report, resolving its district and seeding confidence from reputation', async () => {
    const r = await reports.submit({ hazardType: 'flood', title: 'Water rising near market', ...P1 }, reporterId);
    ids.push(r.id);
    expect(r.place_id).toBeTruthy(); // resolved to Tamale Metropolitan
    expect(Number(r.confidence)).toBe(0.33); // reputation 10 → 0.30 + 0.03
    expect(r.status).toBe('submitted');
  });

  it('auto-corroborates a nearby report of the same hazard', async () => {
    const r2 = await reports.submit({ hazardType: 'flood', title: 'Street flooding', ...P2 }, reporterId);
    ids.push(r2.id);
    expect(r2.corroboration_count).toBe(2);
    expect(Number(r2.confidence)).toBe(0.55); // cluster of 2

    const first = await reports.getReport(ids[0]);
    expect(first?.corroboration_count).toBe(2); // both members updated
    expect(first?.cluster_id).toBe(r2.cluster_id);
  });

  it('verifies a report and rewards reporter reputation', async () => {
    const before = (await conn.db.execute(sql`SELECT reputation_score FROM users WHERE id=${reporterId}`)).rows[0] as { reputation_score: number };
    const r = await reports.review(ids[0], reviewerId, 'verified');
    expect(r.status).toBe('verified');
    const after = (await conn.db.execute(sql`SELECT reputation_score FROM users WHERE id=${reporterId}`)).rows[0] as { reputation_score: number };
    expect(after.reputation_score).toBe(before.reputation_score + 5);
  });

  it('promotes a report into a hazard event', async () => {
    const { eventId: ev } = await reports.promote(ids[1], reviewerId, { severity: 'moderate' });
    eventId = ev;
    const report = await reports.getReport(ids[1]);
    expect(report?.status).toBe('promoted');
    expect(report?.promoted_event_id).toBe(ev);
    const event = (await conn.db.execute(sql`SELECT hazard_type, state FROM hazard_events WHERE id=${ev}`)).rows[0] as { hazard_type: string; state: string };
    expect(event).toMatchObject({ hazard_type: 'flood', state: 'watch' });
  });
});
