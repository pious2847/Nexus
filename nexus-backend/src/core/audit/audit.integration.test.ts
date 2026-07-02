/**
 * Audit trail against a real DB. Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { AuditService } from './audit.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('audit (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let audit: AuditService;
  const action = `test.audit.${Date.now()}`;

  beforeAll(() => {
    conn = createDb();
    audit = new AuditService(conn.db);
  });

  afterAll(async () => {
    if (!conn) return;
    await conn.db.execute(sql`DELETE FROM audit_logs WHERE action = ${action}`);
    await conn.close();
  });

  it('records and reads back an audit entry', async () => {
    await audit.record({ action, resourceType: 'test', metadata: { hello: 'world' } });
    const rows = await audit.recent({ action, limit: 5 });
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe(action);
    expect(rows[0].resource_type).toBe('test');
  });

  it('never throws even on a bad entry (audit must not break the action)', async () => {
    // resource_id must be a uuid; a bad value is swallowed by record()
    await expect(
      audit.record({ action, resourceId: 'not-a-uuid' as unknown as string }),
    ).resolves.toBeUndefined();
  });
});
