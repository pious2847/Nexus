/**
 * Vulnerable-persons registry against a real DB: register → scoped listing
 * (ltree subtree) → status/consent updates → audit → RBAC scope enforcement
 * (a Greater Accra officer must NOT be able to act on a Northern record).
 * Skipped by default; run with:
 *   RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { GeographyService } from '../../core/geography/geography.service';
import { RbacService } from '../../core/rbac/rbac.service';
import { AuditService } from '../../core/audit/audit.service';
import { VulnerablePersonsService } from './vulnerable.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('vulnerable-persons registry (DB)', () => {
  let conn: ReturnType<typeof createDb>;
  let svc: VulnerablePersonsService;
  let rbac: RbacService;
  let northernRegionId = '';
  let tolonId = '';
  let gushieguId = '';
  let officerId = ''; // district_officer scoped to Northern region
  const personIds: string[] = [];

  beforeAll(async () => {
    conn = createDb();
    svc = new VulnerablePersonsService(conn.db, new GeographyService(conn.db), new AuditService(conn.db));
    rbac = new RbacService(conn.db);

    const nr = await conn.db.execute(sql`SELECT id FROM places WHERE level='region' AND name='Northern' LIMIT 1`);
    northernRegionId = (nr.rows[0] as { id: string }).id;
    const tolon = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Tolon' LIMIT 1`);
    tolonId = (tolon.rows[0] as { id: string }).id;
    const gushiegu = await conn.db.execute(sql`SELECT id FROM places WHERE level='district' AND name='Gushegu' LIMIT 1`);
    gushieguId = (gushiegu.rows[0] as { id: string }).id;

    const phone = `+2332911${Math.floor(Math.random() * 899999 + 100000)}`;
    officerId = ((await conn.db.execute(
      sql`INSERT INTO users (name, phone, role, status) VALUES ('VP Officer', ${phone}, 'district_officer', 'active') RETURNING id`,
    )).rows[0] as { id: string }).id;
    await conn.db.execute(sql`INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${officerId}, 'district_officer', ${northernRegionId})`);
  });

  afterAll(async () => {
    if (!conn) return;
    for (const id of personIds) await conn.db.execute(sql`DELETE FROM vulnerable_persons WHERE id = ${id}`);
    await conn.db.execute(sql`DELETE FROM users WHERE id = ${officerId}`);
    await conn.close();
  });

  it('registers a person with consent and audits the action', async () => {
    const person = await svc.register(
      {
        placeId: tolonId,
        fullName: 'Test Person A',
        category: 'bedridden',
        mobilityLevel: 'bedridden',
        consentStatus: 'guardian_given',
        consentBy: 'guardian',
        householdSize: 2,
      },
      officerId,
    );
    personIds.push(person.id);
    expect(person.status).toBe('active');
    expect(person.consent_status).toBe('guardian_given');
    expect(person.consent_at).toBeTruthy();

    const audit = await conn.db.execute(sql`SELECT action FROM audit_logs WHERE resource_id = ${person.id} ORDER BY created_at`);
    expect((audit.rows as { action: string }[]).some((r) => r.action === 'vulnerable.registered')).toBe(true);
  });

  it('lists records scoped to a region subtree, including nested districts', async () => {
    const person2 = await svc.register(
      { placeId: gushieguId, fullName: 'Test Person B', category: 'elderly', mobilityLevel: 'independent', consentStatus: 'given', consentBy: 'self' },
      officerId,
    );
    personIds.push(person2.id);

    const northernList = await svc.listByScope(northernRegionId);
    expect(northernList.length).toBeGreaterThanOrEqual(2);
    expect(northernList.some((p) => p.id === personIds[0])).toBe(true);
    expect(northernList.some((p) => p.id === person2.id)).toBe(true);

    const tolonOnly = await svc.listByScope(tolonId);
    expect(tolonOnly.some((p) => p.id === personIds[0])).toBe(true);
    expect(tolonOnly.some((p) => p.id === person2.id)).toBe(false); // Gushegu record not in Tolon's scope
  });

  it('sorts by evacuation priority when requested', async () => {
    const sorted = await svc.listByScope(northernRegionId, { prioritySort: true });
    const idx = (id: string) => sorted.findIndex((p) => p.id === id);
    expect(idx(personIds[0])).toBeLessThan(idx(personIds[1])); // bedridden ranks above elderly/independent
  });

  it('updates status and consent, auditing both', async () => {
    const updated = await svc.updateStatus(personIds[0], 'evacuated', officerId);
    expect(updated.status).toBe('evacuated');
    const withdrawn = await svc.updateConsent(personIds[0], 'declined', 'guardian', officerId);
    expect(withdrawn.consent_status).toBe('declined');

    const actions = (await conn.db.execute(sql`SELECT action FROM audit_logs WHERE resource_id = ${personIds[0]} ORDER BY created_at`)).rows as { action: string }[];
    expect(actions.some((r) => r.action === 'vulnerable.status_changed')).toBe(true);
    expect(actions.some((r) => r.action === 'vulnerable.consent_changed')).toBe(true);
  });

  it('enforces geographic RBAC: a Northern-scoped officer cannot act on a Greater Accra record', async () => {
    const accra = await conn.db.execute(sql`SELECT id, path::text AS path FROM places WHERE level='region' AND name='Greater Accra' LIMIT 1`);
    const accraPath = (accra.rows[0] as { path: string }).path;

    const northernPath = (await conn.db.execute(sql`SELECT path::text AS path FROM places WHERE id = ${northernRegionId}`)).rows[0] as { path: string };
    expect(await rbac.can(officerId, 'vulnerable.manage', northernPath.path)).toBe(true);
    expect(await rbac.can(officerId, 'vulnerable.manage', accraPath)).toBe(false);
  });
});
