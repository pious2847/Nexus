/**
 * Ingestion helpers against a real DB. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../shared/db';
import { getRainfallTargets } from './ingestion';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('ingestion helpers (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  beforeAll(() => {
    conn = createDb();
  });
  afterAll(async () => {
    if (conn) await conn.close();
  });

  it('builds rainfall targets from the 16 region centroids', async () => {
    const targets = await getRainfallTargets(conn.db);
    expect(targets).toHaveLength(16);
    for (const t of targets) {
      expect(t.placeId).toBeTruthy();
      expect(typeof t.lat).toBe('number');
      expect(typeof t.lng).toBe('number');
      // Ghana bounding box sanity
      expect(t.lat).toBeGreaterThan(4);
      expect(t.lat).toBeLessThan(12);
      expect(t.lng).toBeGreaterThan(-4);
      expect(t.lng).toBeLessThan(2);
    }
  });
});
