/**
 * Data access for shelters & safe zones (Module M — Emergency Response &
 * Coordination). Geo-tagged registry with occupancy tracking; mirrors
 * health-facility.repository.ts's style (Drizzle `sql` tag, ltree subtree
 * scope checks via `listByScope`, nearest-point lookup mirroring
 * geography.repository.ts's `findNearest`).
 *
 * DDL: src/db/migrations/0018_emergency_response.sql (shelters table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

/**
 * Build a `text[]` SQL fragment from a JS array. Needed because drizzle expands
 * a bare array param into a tuple, which can't be cast to text[] (mirrors
 * notifications.repository.ts's textArray() / volunteer.repository.ts's textArray()).
 */
function textArray(values: string[] | null | undefined) {
  if (values == null) return sql`NULL`;
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export interface ShelterRow {
  id: string;
  place_id: string;
  name: string;
  capacity: number | null;
  current_occupancy: number;
  facilities: string[];
  status: string;
  contact_phone: string | null;
  managed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, name, capacity, current_occupancy, facilities, status, contact_phone, managed_by, notes, created_at, updated_at`;

export interface InsertShelterInput {
  placeId: string;
  name: string;
  capacity?: number | null;
  facilities?: string[];
  contactPhone?: string | null;
  managedBy?: string | null;
  notes?: string | null;
  lng?: number | null;
  lat?: number | null;
}

export async function insertShelter(db: Db, p: InsertShelterInput): Promise<ShelterRow> {
  const geom = p.lng != null && p.lat != null ? sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)` : sql`NULL`;
  const r = await db.execute(sql`
    INSERT INTO shelters (place_id, geometry, name, capacity, facilities, contact_phone, managed_by, notes)
    VALUES (
      ${p.placeId}, ${geom}, ${p.name}, ${p.capacity ?? null}, ${textArray(p.facilities ?? [])},
      ${p.contactPhone ?? null}, ${p.managedBy ?? null}, ${p.notes ?? null}
    )
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as ShelterRow;
}

export async function getShelter(db: Db, id: string): Promise<ShelterRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM shelters WHERE id = ${id}`);
  return (r.rows[0] as unknown as ShelterRow) ?? null;
}

/** ltree path of the shelter's place, for RBAC scope checks (mirrors getFacilityPlacePath). */
export async function getShelterPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM shelters s JOIN places p ON s.place_id = p.id WHERE s.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface ListShelterFilter {
  status?: string;
  /** Only shelters with a known capacity and current_occupancy < capacity. */
  hasCapacity?: boolean;
}

/** List shelters within a geography subtree (the scope place and everything under it). */
export async function listByScope(db: Db, scopePlaceId: string, f: ListShelterFilter = {}): Promise<ShelterRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.status) conds.push(sql`s.status = ${f.status}`);
  if (f.hasCapacity) conds.push(sql`s.capacity IS NOT NULL AND s.current_occupancy < s.capacity`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`s.id`, sql`s.place_id`, sql`s.name`, sql`s.capacity`, sql`s.current_occupancy`,
        sql`s.facilities`, sql`s.status`, sql`s.contact_phone`, sql`s.managed_by`, sql`s.notes`,
        sql`s.created_at`, sql`s.updated_at`,
      ],
      sql`, `,
    )}
    FROM shelters s JOIN places p ON s.place_id = p.id
    WHERE ${where}
    ORDER BY s.created_at DESC
  `);
  return r.rows as unknown as ShelterRow[];
}

export interface UpdateShelterPatch {
  name?: string;
  capacity?: number | null;
  status?: string;
  contactPhone?: string | null;
  notes?: string | null;
  facilities?: string[];
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateShelter(db: Db, id: string, patch: UpdateShelterPatch): Promise<ShelterRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.capacity !== undefined) sets.push(sql`capacity = ${patch.capacity}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.contactPhone !== undefined) sets.push(sql`contact_phone = ${patch.contactPhone}`);
  if (patch.notes !== undefined) sets.push(sql`notes = ${patch.notes}`);
  if (patch.facilities !== undefined) sets.push(sql`facilities = ${textArray(patch.facilities)}`);
  if (sets.length === 0) return getShelter(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE shelters SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as ShelterRow) ?? null;
}

/**
 * Atomically increment/decrement current_occupancy, clamped at a minimum of
 * 0. Does not enforce the capacity ceiling — the service layer reads the
 * updated row and decides whether to auto-transition status.
 */
export async function updateOccupancy(db: Db, id: string, delta: number): Promise<ShelterRow | null> {
  const r = await db.execute(sql`
    UPDATE shelters
    SET current_occupancy = GREATEST(0, current_occupancy + ${delta}), updated_at = now()
    WHERE id = ${id}
    RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as ShelterRow) ?? null;
}

/**
 * Nearest open shelters to a point, ordered by PostGIS KNN distance
 * (mirrors geography.repository.ts's findNearest). Citizen-facing / public —
 * no scope filter here, that's a route-layer decision (this endpoint is
 * intentionally unscoped).
 */
export async function findNearestOpen(
  db: Db,
  point: { lng: number; lat: number },
  limit = 5,
): Promise<(ShelterRow & { meters: number })[]> {
  const p = sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)`;
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`id`, sql`place_id`, sql`name`, sql`capacity`, sql`current_occupancy`,
        sql`facilities`, sql`status`, sql`contact_phone`, sql`managed_by`, sql`notes`,
        sql`created_at`, sql`updated_at`,
      ],
      sql`, `,
    )}, ST_Distance(geometry::geography, ${p}::geography) AS meters
    FROM shelters
    WHERE status = 'open' AND geometry IS NOT NULL
    ORDER BY geometry <-> ${p}
    LIMIT ${limit}
  `);
  return r.rows as unknown as (ShelterRow & { meters: number })[];
}
