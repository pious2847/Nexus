/**
 * Data access for the health-facility registry (Module D — Health & Disease
 * Surveillance). Public infrastructure data (clinics, hospitals, CHPS
 * compounds) — unlike the vulnerable-persons registry this is not sensitive
 * PII, but lists are still scoped by geography subtree (ltree `path <@`), the
 * same pattern used across the codebase (vulnerable-persons, hazard map).
 *
 * DDL: src/db/migrations/0011_health_surveillance.sql (health_facilities table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface HealthFacilityRow {
  id: string;
  place_id: string;
  name: string;
  facility_type: string;
  ownership: string | null;
  contact_phone: string | null;
  bed_count: number | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, name, facility_type, ownership, contact_phone, bed_count, status, created_by, created_at, updated_at`;

export interface InsertFacilityInput {
  placeId: string;
  name: string;
  facilityType: string;
  ownership?: string | null;
  contactPhone?: string | null;
  bedCount?: number | null;
  lng?: number | null;
  lat?: number | null;
  createdBy: string;
}

export async function insertFacility(db: Db, p: InsertFacilityInput): Promise<HealthFacilityRow> {
  const geom = p.lng != null && p.lat != null ? sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)` : sql`NULL`;
  const r = await db.execute(sql`
    INSERT INTO health_facilities (place_id, geometry, name, facility_type, ownership, contact_phone, bed_count, created_by)
    VALUES (${p.placeId}, ${geom}, ${p.name}, ${p.facilityType}, ${p.ownership ?? null}, ${p.contactPhone ?? null}, ${p.bedCount ?? null}, ${p.createdBy})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as HealthFacilityRow;
}

export async function getFacility(db: Db, id: string): Promise<HealthFacilityRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM health_facilities WHERE id = ${id}`);
  return (r.rows[0] as unknown as HealthFacilityRow) ?? null;
}

/** ltree path of the facility's place, for RBAC scope checks (mirrors getPersonPlacePath). */
export async function getFacilityPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM health_facilities h JOIN places p ON h.place_id = p.id WHERE h.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

/** List facilities within a geography subtree (the scope place and everything under it). */
export async function listByScope(
  db: Db,
  scopePlaceId: string,
  f: { facilityType?: string; status?: string } = {},
): Promise<HealthFacilityRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.facilityType) conds.push(sql`h.facility_type = ${f.facilityType}`);
  if (f.status) conds.push(sql`h.status = ${f.status}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`h.id`, sql`h.place_id`, sql`h.name`, sql`h.facility_type`, sql`h.ownership`,
        sql`h.contact_phone`, sql`h.bed_count`, sql`h.status`, sql`h.created_by`,
        sql`h.created_at`, sql`h.updated_at`,
      ],
      sql`, `,
    )}
    FROM health_facilities h JOIN places p ON h.place_id = p.id
    WHERE ${where}
    ORDER BY h.created_at DESC
  `);
  return r.rows as unknown as HealthFacilityRow[];
}

export interface UpdateFacilityPatch {
  name?: string;
  facilityType?: string;
  ownership?: string | null;
  contactPhone?: string | null;
  bedCount?: number | null;
  status?: string;
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateFacility(db: Db, id: string, patch: UpdateFacilityPatch): Promise<HealthFacilityRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.facilityType !== undefined) sets.push(sql`facility_type = ${patch.facilityType}`);
  if (patch.ownership !== undefined) sets.push(sql`ownership = ${patch.ownership}`);
  if (patch.contactPhone !== undefined) sets.push(sql`contact_phone = ${patch.contactPhone}`);
  if (patch.bedCount !== undefined) sets.push(sql`bed_count = ${patch.bedCount}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (sets.length === 0) return getFacility(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE health_facilities SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as HealthFacilityRow) ?? null;
}
