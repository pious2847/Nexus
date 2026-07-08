/**
 * Health-facility registry against a real DB: register → scoped listing (ltree
 * subtree) → partial update → audit → RBAC scope enforcement.
 *
 * STUB — left for reference only. Per the module task, this was NOT run by the
 * agent that wrote it (the orchestrating session writes/runs the live-DB
 * integration test itself against the shared dev database, to avoid concurrent
 * writes clashing with the parallel disease-cases module's own DB tests).
 * Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../shared/db';
import { GeographyService } from '../../../core/geography/geography.service';
import { RbacService } from '../../../core/rbac/rbac.service';
import { AuditService } from '../../../core/audit/audit.service';
import { HealthFacilityService } from './health-facility.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('health-facility registry (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let svc: HealthFacilityService;
  let rbac: RbacService;
  let northernRegionId = '';
  let tolonId = '';
  let gushieguId = '';
  let officerId = ''; // district_officer scoped to Northern region
  const facilityIds: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    svc = new HealthFacilityService(conn.db, new GeographyService(conn.db), new AuditService(conn.db));
    rbac = new RbacService(conn.db);

    const nr = await conn.db.execute(sql`SELECT id FROM places WHERE level='region' AND name='Northern' LIMIT 1`);
    northernRegionId = (nr.rows[0] as { id: string }).id;
    const tolon = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    tolonId = (tolon.rows[0] as { id: string }).id;
    const gushiegu = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Gushegu' LIMIT 1`);
    gushieguId = (gushiegu.rows[0] as { id: string }).id;

    const phone = `+2332912${Math.floor(Math.random() * 899999 + 100000)}`;
    officerId = ((await conn.db.execute(
      sql`INSERT INTO users (name, phone, role, status) VALUES ('HF Officer', ${phone}, 'district_officer', 'active') RETURNING id`,
    )).rows[0] as { id: string }).id;
    await conn.db.execute(sql`INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${officerId}, 'district_officer', ${northernRegionId})`);
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of facilityIds) await conn.db.execute(sql`DELETE FROM health_facilities WHERE id = ${id}`);
    await conn.db.execute(sql`DELETE FROM users WHERE id = ${officerId}`);
    await conn.close();
  });

  it('registers a facility and audits the action', async () => {
    const facility = await svc.register(
      { placeId: tolonId, name: 'Tolon Clinic A', facilityType: 'clinic', ownership: 'government' },
      officerId,
    );
    facilityIds.push(facility.id);
    expect(facility.status).toBe('active');

    const audit = await conn.db.execute(sql`SELECT action FROM audit_logs WHERE resource_id = ${facility.id} ORDER BY created_at`);
    expect((audit.rows as { action: string }[]).some((r) => r.action === 'health.facility.registered')).toBe(true);
  });

  it('lists facilities scoped to a region subtree, including nested districts', async () => {
    const facility2 = await svc.register(
      { placeId: gushieguId, name: 'Gushegu Hospital', facilityType: 'hospital', ownership: 'government' },
      officerId,
    );
    facilityIds.push(facility2.id);

    const northernList = await svc.listByScope(northernRegionId);
    expect(northernList.some((f) => f.id === facilityIds[0])).toBe(true);
    expect(northernList.some((f) => f.id === facility2.id)).toBe(true);

    const tolonOnly = await svc.listByScope(tolonId);
    expect(tolonOnly.some((f) => f.id === facilityIds[0])).toBe(true);
    expect(tolonOnly.some((f) => f.id === facility2.id)).toBe(false); // Gushegu record not in Tolon's scope
  });

  it('partially updates a facility and audits what changed', async () => {
    const updated = await svc.update(facilityIds[0], { bedCount: 12, status: 'active' }, officerId);
    expect(updated.bed_count).toBe(12);

    const actions = (await conn.db.execute(sql`SELECT action FROM audit_logs WHERE resource_id = ${facilityIds[0]} ORDER BY created_at`)).rows as { action: string }[];
    expect(actions.some((r) => r.action === 'health.facility.updated')).toBe(true);
  });

  it('enforces geographic RBAC: a Northern-scoped officer cannot manage a Greater Accra facility', async () => {
    const accra = await conn.db.execute(sql`SELECT path::text AS path FROM places WHERE level='region' AND name='Greater Accra' LIMIT 1`);
    const accraPath = (accra.rows[0] as { path: string }).path;
    const northernPath = (await conn.db.execute(sql`SELECT path::text AS path FROM places WHERE id = ${northernRegionId}`)).rows[0] as { path: string };
    expect(await rbac.can(officerId, 'health.facility.manage' as never, northernPath.path)).toBe(true);
    expect(await rbac.can(officerId, 'health.facility.manage' as never, accraPath)).toBe(false);
  });
});
