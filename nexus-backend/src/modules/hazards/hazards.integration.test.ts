/**
 * Hazard lifecycle against a real DB. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('hazard lifecycle (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let hazards: HazardService;
  let placeId = '';
  let eventId = '';

  beforeAll(async () => {
    conn = createDb();
    hazards = new HazardService(conn.db);
    const p = await conn.db.execute(sql`SELECT id FROM places WHERE level = 'district' AND name = 'Tolon' LIMIT 1`);
    placeId = (p.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    if (!conn) return;
    if (eventId) await conn.db.execute(sql`DELETE FROM hazard_events WHERE id = ${eventId}`); // cascades transitions
    await conn.close();
  });

  it('raises an event with an initial transition and severity colour', async () => {
    const event = await hazards.raiseEvent({
      hazardType: 'flood',
      placeId,
      title: 'Test flood watch (Tolon)',
      severity: 'severe',
      state: 'watch',
    });
    eventId = event.id;
    expect(event.state).toBe('watch');
    expect(event.color).toBe('#EF6C00'); // severe
    const transitions = await hazards.eventTransitions(eventId);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to_state).toBe('watch');
  });

  it('walks the valid lifecycle and records each transition', async () => {
    await hazards.transition(eventId, 'warning', null, 'rainfall rising');
    await hazards.transition(eventId, 'active', null, 'flooding observed');
    const event = await hazards.transition(eventId, 'closed', null, 'waters receded');
    expect(event.state).toBe('closed');
    expect(event.closed_at).toBeTruthy();
    expect(event.started_at).toBeTruthy(); // set when it went active

    const transitions = await hazards.eventTransitions(eventId);
    expect(transitions.map((t) => t.to_state)).toEqual(['watch', 'warning', 'active', 'closed']);
  });

  it('rejects an illegal transition from a terminal state', async () => {
    await expect(hazards.transition(eventId, 'active', null)).rejects.toThrow(/Illegal hazard/);
  });
});
