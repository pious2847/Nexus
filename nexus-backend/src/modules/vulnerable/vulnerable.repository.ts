/**
 * Data access for the vulnerable-persons registry. Sensitive PII — every list
 * is scoped by geography subtree (never a global "all persons" query) and the
 * service layer is responsible for the RBAC check before calling here.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface VulnerablePersonRow {
  id: string;
  place_id: string;
  full_name: string;
  category: string;
  mobility_level: string;
  household_contact_phone: string | null;
  household_size: number | null;
  special_needs: string | null;
  consent_status: string;
  consent_by: string | null;
  consent_at: string | null;
  status: string;
  registered_by: string | null;
  created_at: string;
}

const COLS = sql`id, place_id, full_name, category, mobility_level, household_contact_phone,
  household_size, special_needs, consent_status, consent_by, consent_at, status, registered_by, created_at`;

export interface InsertVulnerablePersonInput {
  placeId: string;
  fullName: string;
  category: string;
  mobilityLevel: string;
  householdContactPhone?: string | null;
  householdSize?: number | null;
  specialNeeds?: string | null;
  consentStatus: string;
  consentBy?: string | null;
  lng?: number | null;
  lat?: number | null;
  registeredBy: string;
}

export async function insertVulnerablePerson(db: Db, p: InsertVulnerablePersonInput): Promise<VulnerablePersonRow> {
  const geom = p.lng != null && p.lat != null ? sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)` : sql`NULL`;
  const consentAt = p.consentStatus === 'pending' ? sql`NULL` : sql`now()`;
  const r = await db.execute(sql`
    INSERT INTO vulnerable_persons (place_id, geometry, full_name, category, mobility_level,
      household_contact_phone, household_size, special_needs, consent_status, consent_by, consent_at, registered_by)
    VALUES (${p.placeId}, ${geom}, ${p.fullName}, ${p.category}, ${p.mobilityLevel},
      ${p.householdContactPhone ?? null}, ${p.householdSize ?? null}, ${p.specialNeeds ?? null},
      ${p.consentStatus}, ${p.consentBy ?? null}, ${consentAt}, ${p.registeredBy})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as VulnerablePersonRow;
}

export async function getVulnerablePerson(db: Db, id: string): Promise<VulnerablePersonRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM vulnerable_persons WHERE id = ${id}`);
  return (r.rows[0] as unknown as VulnerablePersonRow) ?? null;
}

export async function getPersonPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM vulnerable_persons v JOIN places p ON v.place_id = p.id WHERE v.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

/** List persons within a geography subtree (the scope place and everything under it). */
export async function listByScope(
  db: Db,
  scopePlaceId: string,
  f: { status?: string; category?: string } = {},
): Promise<VulnerablePersonRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.status) conds.push(sql`v.status = ${f.status}`);
  if (f.category) conds.push(sql`v.category = ${f.category}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`v.id`, sql`v.place_id`, sql`v.full_name`, sql`v.category`, sql`v.mobility_level`,
        sql`v.household_contact_phone`, sql`v.household_size`, sql`v.special_needs`,
        sql`v.consent_status`, sql`v.consent_by`, sql`v.consent_at`, sql`v.status`,
        sql`v.registered_by`, sql`v.created_at`,
      ],
      sql`, `,
    )}
    FROM vulnerable_persons v JOIN places p ON v.place_id = p.id
    WHERE ${where}
    ORDER BY v.created_at DESC
  `);
  return r.rows as unknown as VulnerablePersonRow[];
}

export async function updateStatus(db: Db, id: string, status: string): Promise<void> {
  await db.execute(sql`UPDATE vulnerable_persons SET status = ${status}, updated_at = now() WHERE id = ${id}`);
}

export async function updateConsent(db: Db, id: string, consentStatus: string, consentBy?: string | null): Promise<void> {
  await db.execute(sql`
    UPDATE vulnerable_persons
    SET consent_status = ${consentStatus}, consent_by = ${consentBy ?? null},
        consent_at = ${consentStatus === 'pending' ? sql`NULL` : sql`now()`}, updated_at = now()
    WHERE id = ${id}
  `);
}
