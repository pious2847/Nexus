/**
 * National multi-hazard map against a real DB — including whatever hazard
 * events currently exist from the live evaluator runs (drought/flood/bushfire/
 * rainfall). Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../shared/db';
import { HazardMapService } from './hazardmap.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('national multi-hazard map (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let map: HazardMapService;

  beforeAll(() => {
    conn = createDb();
    map = new HazardMapService(conn.db);
  });
  afterAll(async () => {
    if (conn) await conn.close();
  });

  it('returns exactly 261 district features, all with valid risk properties', async () => {
    const fc = await map.districtRisk();
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(261);
    for (const f of fc.features) {
      expect(f.type).toBe('Feature');
      expect(typeof f.properties.riskColor).toBe('string');
      expect(f.properties.riskColor).toMatch(/^#/);
      expect(Array.isArray(f.properties.hazardTypes)).toBe(true);
      expect(typeof f.properties.hasGeometry).toBe('boolean');
    }
  });

  it('represents Guan District (no boundary yet) with geometry:null rather than dropping it', async () => {
    // Tracked follow-on since Phase 0: Guan (Oti) post-dates the 2019 geoBoundaries
    // source and has no boundary polygon yet. It must still appear (list/alert
    // views need its risk status) — just not drawable on the map until sourced.
    const fc = await map.districtRisk();
    const guan = fc.features.find((f) => f.properties.name === 'Guan');
    expect(guan).toBeTruthy();
    expect(guan!.geometry).toBeNull();
    expect(guan!.properties.hasGeometry).toBe(false);

    const withGeometry = fc.features.filter((f) => f.properties.hasGeometry);
    expect(withGeometry.length).toBe(260);
    expect(withGeometry.every((f) => f.geometry !== null)).toBe(true);
  });

  it('returns valid event features (whatever is currently active)', async () => {
    const fc = await map.eventFeatures({});
    expect(fc.type).toBe('FeatureCollection');
    for (const f of fc.features) {
      expect(f.geometry).toBeTruthy();
      expect(f.properties.hazardType).toBeTruthy();
      expect(f.properties.color).toMatch(/^#/);
    }
  });

  it('filters event features by hazard type', async () => {
    const all = await map.eventFeatures({});
    const flood = await map.eventFeatures({ hazardType: 'flood' });
    expect(flood.features.every((f) => f.properties.hazardType === 'flood')).toBe(true);
    expect(flood.features.length).toBeLessThanOrEqual(all.features.length);
  });

  it('produces a national summary consistent with the event features', async () => {
    // summary counts all active events; eventFeatures additionally requires a
    // resolvable geometry (event/place), so summary >= visible features.
    const summary = await map.summary();
    const eventsFc = await map.eventFeatures({});
    expect(summary.totalActive).toBeGreaterThanOrEqual(eventsFc.features.length);
  });
});
