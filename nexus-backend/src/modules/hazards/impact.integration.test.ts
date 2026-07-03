/**
 * Impact-based forecasting against a real DB. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';
import { computeImpact, summarizeImpact } from './impact';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('impact-based forecasting (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let hazards: HazardService;
  let regionId = '';
  let eventId = '';

  beforeAll(async () => {
    conn = createDb();
    hazards = new HazardService(conn.db);
    const r = await conn.db.execute(sql`SELECT id FROM places WHERE level = 'region' AND name = 'Northern' LIMIT 1`);
    regionId = (r.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    if (!conn) return;
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`);
    await conn.close();
  });

  it('computes population + facility exposure over the place subtree', async () => {
    const impact = await computeImpact(conn.db, regionId);
    expect(impact).not.toBeNull();
    expect(impact!.population).toBeGreaterThan(0); // Northern region has population
    expect(impact!.districtsInScope).toBeGreaterThan(0); // region has districts
    expect(impact!.facilities).toMatchObject({
      schools: expect.any(Number),
      toilets: expect.any(Number),
      wasteFacilities: expect.any(Number),
    });
    expect(summarizeImpact(impact!)).toContain('people');
  });

  it('counts a geo-tagged facility within the affected subtree', async () => {
    // temp toilet in a Northern district (within the Northern region subtree)
    const d = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    const districtId = (d.rows[0] as { id: string }).id;
    const before = (await computeImpact(conn.db, regionId))!.facilities.toilets;
    const t = await conn.db.execute(sql`
      INSERT INTO registered_toilets (owner_name, owner_phone, toilet_type, ownership_type, location_name, district, latitude, longitude, place_id)
      VALUES ('Impact Test', '+233200000000', 'pit_latrine', 'public', 'Test site', 'Tolon', 9.43, -0.99, ${districtId})
      RETURNING id
    `);
    const toiletId = (t.rows[0] as { id: string }).id;
    try {
      const after = (await computeImpact(conn.db, regionId))!.facilities.toilets;
      expect(after).toBe(before + 1);
    } finally {
      await conn.db.execute(sql`DELETE FROM registered_toilets WHERE id = ${toiletId}`);
    }
  });

  it('attaches impact_summary automatically when an event is raised', async () => {
    const event = await hazards.raiseEvent({
      hazardType: 'flood',
      placeId: regionId,
      title: 'Impact test — Northern',
      state: 'watch',
    });
    eventId = event.id;
    const impact = event.impact_summary as { population: number | null; facilities: object } | null;
    expect(impact).toBeTruthy();
    expect(impact!.population).toBeGreaterThan(0);
    expect(impact!.facilities).toBeTruthy();
  });
});
