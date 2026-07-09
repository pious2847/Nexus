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

/**
 * Live capacity time series (Module N16 — mass-casualty coordination).
 * DDL: src/db/migrations/0021_damage_assessments_facility_capacity.sql
 * (facility_capacity_status table). Every report is a NEW row — never
 * updated in place — so "current status" is always the latest row per
 * facility, ordered by reported_at DESC.
 */
export interface CapacityStatusRow {
  id: string;
  facility_id: string;
  beds_available: number | null;
  blood_units_available: number | null;
  ambulances_available: number | null;
  status: string;
  reported_by: string | null;
  reported_at: string;
}

const CAPACITY_COLS = sql`id, facility_id, beds_available, blood_units_available, ambulances_available, status, reported_by, reported_at`;

export interface InsertCapacityStatusInput {
  bedsAvailable?: number | null;
  bloodUnitsAvailable?: number | null;
  ambulancesAvailable?: number | null;
  status: string;
  reportedBy?: string | null;
}

/** Insert a new capacity report for a facility. Never updates in place. */
export async function insertCapacityStatus(
  db: Db,
  facilityId: string,
  input: InsertCapacityStatusInput,
): Promise<CapacityStatusRow> {
  const r = await db.execute(sql`
    INSERT INTO facility_capacity_status (facility_id, beds_available, blood_units_available, ambulances_available, status, reported_by)
    VALUES (${facilityId}, ${input.bedsAvailable ?? null}, ${input.bloodUnitsAvailable ?? null}, ${input.ambulancesAvailable ?? null}, ${input.status}, ${input.reportedBy ?? null})
    RETURNING ${CAPACITY_COLS}
  `);
  return r.rows[0] as unknown as CapacityStatusRow;
}

/** Latest capacity report for a facility, or null if none has ever been filed. */
export async function getLatestCapacityStatus(db: Db, facilityId: string): Promise<CapacityStatusRow | null> {
  const r = await db.execute(sql`
    SELECT ${CAPACITY_COLS} FROM facility_capacity_status
    WHERE facility_id = ${facilityId}
    ORDER BY reported_at DESC
    LIMIT 1
  `);
  return (r.rows[0] as unknown as CapacityStatusRow) ?? null;
}

export interface NearestWithCapacityRow {
  id: string;
  name: string;
  facility_type: string;
  contact_phone: string | null;
  lng: number;
  lat: number;
  beds_available: number | null;
  blood_units_available: number | null;
  ambulances_available: number | null;
  status: string;
  reported_at: string;
  meters: number;
}

/**
 * Nearest facility to a point that has a (non-closed) capacity report meeting
 * the given filters, ordered by PostGIS KNN distance (mirrors
 * shelter.repository.ts's findNearestOpen). Citizen/responder-facing / public
 * — no scope filter, that's a route-layer decision.
 */
export async function findNearestWithCapacity(
  db: Db,
  point: { lng: number; lat: number },
  opts: { minBeds?: number; status?: string } = {},
  limit = 5,
): Promise<NearestWithCapacityRow[]> {
  const p = sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)`;
  const conds = [sql`f.geometry IS NOT NULL`, sql`l.status != 'closed'`];
  if (opts.minBeds != null) conds.push(sql`l.beds_available >= ${opts.minBeds}`);
  if (opts.status) conds.push(sql`l.status = ${opts.status}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (facility_id) *
      FROM facility_capacity_status
      ORDER BY facility_id, reported_at DESC
    )
    SELECT f.id, f.name, f.facility_type, f.contact_phone,
           ST_X(f.geometry) AS lng, ST_Y(f.geometry) AS lat,
           l.beds_available, l.blood_units_available, l.ambulances_available, l.status, l.reported_at,
           ST_Distance(f.geometry::geography, ${p}::geography) AS meters
    FROM health_facilities f
    JOIN latest l ON l.facility_id = f.id
    WHERE ${where}
    ORDER BY f.geometry <-> ${p}
    LIMIT ${limit}
  `);
  return r.rows as unknown as NearestWithCapacityRow[];
}
