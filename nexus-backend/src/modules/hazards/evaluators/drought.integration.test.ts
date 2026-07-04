/**
 * Drought ingestion against a real DB + live Open-Meteo historical archive.
 * Actual drought severity depends on real (unpredictable) weather, so this
 * test asserts the pipeline's deterministic guarantees — correct summary
 * shape, no throw, correct DB rows *if* an event is created — using a small
 * target subset to keep network cost low. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { HazardService } from '../hazards.service';
import { getRainfallTargets } from '../ingestion';
import { DroughtEvaluator } from './drought';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('drought ingestion (DB + live Open-Meteo archive)', () => {
  let conn: ReturnType<typeof createDb>;
  let hazards: HazardService;
  const createdEventIds: string[] = [];

  beforeAll(() => {
    conn = createDb();
    hazards = new HazardService(conn.db);
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of createdEventIds) {
      await conn.db.execute(sql`DELETE FROM hazard_predictions WHERE hazard_event_id = ${id}`);
      await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${id}`);
    }
    await conn.close();
  });

  it('evaluates a target subset against live data without throwing, and persists valid events', async () => {
    const all = await getRainfallTargets(conn.db);
    const targets = all.slice(0, 2); // keep network cost low; full 261/16-region run is the CLI's job
    expect(targets.length).toBe(2);

    const evaluator = new DroughtEvaluator({ db: conn.db, hazards });
    const summary = await evaluator.run(targets);

    expect(summary.evaluated).toBe(2);
    expect(summary.created.length + summary.updated.length + summary.skipped.length).toBeLessThanOrEqual(2);
    createdEventIds.push(...summary.created);

    for (const id of summary.created) {
      const ev = (await conn.db.execute(sql`SELECT hazard_type, state, certainty, urgency, source FROM hazard_events WHERE id = ${id}`)).rows[0] as {
        hazard_type: string; state: string; certainty: string; urgency: string; source: string;
      };
      expect(ev).toMatchObject({ hazard_type: 'drought', state: 'watch', certainty: 'likely', urgency: 'future', source: 'auto' });

      const pred = (await conn.db.execute(sql`SELECT evaluator_key, sources, factors FROM hazard_predictions WHERE hazard_event_id = ${id}`)).rows[0] as {
        evaluator_key: string; sources: string[]; factors: { deficit_pct: number };
      };
      expect(pred.evaluator_key).toBe('rules');
      expect(pred.sources).toContain('open-meteo-archive');
      expect(pred.factors.deficit_pct).toBeGreaterThanOrEqual(40); // only severities >= minor create an event
    }
  }, 30000); // two live multi-year historical fetches
});
