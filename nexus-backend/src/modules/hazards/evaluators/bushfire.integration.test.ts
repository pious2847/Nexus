/**
 * Bushfire ingestion against a real DB (fixture fire points → hazard events).
 * Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { HazardService } from '../hazards.service';
import { GeographyService } from '../../../core/geography/geography.service';
import { BushfireEvaluator } from './bushfire';
import type { FirePoint } from '../../../integrations/firms';

const RUN = !!process.env.RUN_DB_TESTS;

// Three detections near Tamale (all inside Tamale Metropolitan), one high-FRP.
const FIRES: FirePoint[] = [
  { lat: 9.4008, lng: -0.8393, confidence: 'h', frp: 60, brightness: 320 },
  { lat: 9.41, lng: -0.85, confidence: 'n', frp: 20, brightness: 305 },
  { lat: 9.39, lng: -0.83, confidence: 'l', frp: 8, brightness: 300 },
];

describe.runIf(RUN)('bushfire ingestion (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let evaluator: BushfireEvaluator;
  let tamaleId = '';

  beforeAll(async () => {
    conn = createDb();
    const hazards = new HazardService(conn.db);
    const geography = new GeographyService(conn.db);
    evaluator = new BushfireEvaluator({ db: conn.db, hazards, geography });
    const p = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tamale Metropolitan' LIMIT 1`);
    tamaleId = (p.rows[0] as { id: string }).id;
    // clean any leftover auto bushfire events for this district
    await conn.db.execute(sql`DELETE FROM hazard_events WHERE hazard_type='bushfire' AND place_id=${tamaleId} AND source='auto'`);
  });

  afterAll(async () => {
    if (!conn) return;
    await conn.db.execute(sql`DELETE FROM hazard_predictions WHERE hazard_type='bushfire' AND place_id=${tamaleId}`);
    await conn.db.execute(sql`DELETE FROM hazard_events WHERE hazard_type='bushfire' AND place_id=${tamaleId} AND source='auto'`);
    await conn.close();
  });

  it('groups fires by district and raises one auto event (severe, observed)', async () => {
    const summary = await evaluator.run(FIRES);
    expect(summary.fires).toBe(3);
    expect(summary.districts).toBe(1); // all in Tamale Metropolitan
    expect(summary.created).toHaveLength(1);

    const ev = await conn.db.execute(sql`
      SELECT state, severity, certainty, source FROM hazard_events WHERE id = ${summary.created[0]}
    `);
    expect(ev.rows[0]).toMatchObject({ state: 'watch', severity: 'severe', certainty: 'observed', source: 'auto' });

    const pred = await conn.db.execute(sql`
      SELECT evaluator_key, sources FROM hazard_predictions WHERE hazard_event_id = ${summary.created[0]}
    `);
    expect((pred.rows[0] as { evaluator_key: string }).evaluator_key).toBe('external');
  });

  it('is idempotent within the dedup window (updates, does not duplicate)', async () => {
    const summary = await evaluator.run(FIRES);
    expect(summary.created).toHaveLength(0);
    expect(summary.updated).toHaveLength(1);
    const count = await conn.db.execute(sql`
      SELECT count(*)::int AS n FROM hazard_events WHERE hazard_type='bushfire' AND place_id=${tamaleId} AND source='auto' AND state<>'closed'
    `);
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });
});
