/**
 * Data access for the volunteer roster (Module M — Emergency Response &
 * Coordination). `listByScope` uses ltree subtree (`path <@`), the same
 * pattern as the vulnerable-persons / health-facility registries; `skills`
 * filters via array-contains (`skills @> ARRAY[$skill]`).
 *
 * DDL: src/db/migrations/0018_emergency_response.sql (volunteers table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

/**
 * Build a `text[]` SQL fragment from a JS array. Needed because drizzle expands
 * a bare array param into a tuple `($1,$2)`, which can't be cast to text[]
 * (mirrors `core/notifications/notifications.repository.ts`'s `textArray`).
 */
function textArray(values: string[] | null | undefined) {
  if (values == null) return sql`NULL`;
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export interface VolunteerRow {
  id: string;
  user_id: string | null;
  name: string;
  phone: string | null;
  place_id: string;
  skills: string[];
  availability: string;
  assigned_task: string | null;
  registered_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, user_id, name, phone, place_id, skills, availability, assigned_task, registered_by, created_at, updated_at`;

export interface InsertVolunteerInput {
  userId?: string | null;
  name: string;
  phone?: string | null;
  placeId: string;
  skills?: string[];
  registeredBy?: string | null;
}

export async function insertVolunteer(db: Db, v: InsertVolunteerInput): Promise<VolunteerRow> {
  const r = await db.execute(sql`
    INSERT INTO volunteers (user_id, name, phone, place_id, skills, registered_by)
    VALUES (${v.userId ?? null}, ${v.name}, ${v.phone ?? null}, ${v.placeId}, ${textArray(v.skills ?? [])}, ${v.registeredBy ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as VolunteerRow;
}

export async function getVolunteer(db: Db, id: string): Promise<VolunteerRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM volunteers WHERE id = ${id}`);
  return (r.rows[0] as unknown as VolunteerRow) ?? null;
}

/** ltree path of the volunteer's base place, for RBAC scope checks. */
export async function getVolunteerPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM volunteers v JOIN places p ON v.place_id = p.id WHERE v.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

/** List volunteers within a geography subtree (the scope place and everything under it). */
export async function listByScope(
  db: Db,
  scopePlaceId: string,
  f: { availability?: string; skill?: string } = {},
): Promise<VolunteerRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.availability) conds.push(sql`v.availability = ${f.availability}`);
  if (f.skill) conds.push(sql`v.skills @> ARRAY[${f.skill}]::text[]`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`v.id`, sql`v.user_id`, sql`v.name`, sql`v.phone`, sql`v.place_id`, sql`v.skills`,
        sql`v.availability`, sql`v.assigned_task`, sql`v.registered_by`, sql`v.created_at`, sql`v.updated_at`,
      ],
      sql`, `,
    )}
    FROM volunteers v JOIN places p ON v.place_id = p.id
    WHERE ${where}
    ORDER BY v.created_at DESC
  `);
  return r.rows as unknown as VolunteerRow[];
}

export interface UpdateVolunteerPatch {
  availability?: string;
  skills?: string[];
  assignedTask?: string | null;
  name?: string;
  phone?: string | null;
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateVolunteer(db: Db, id: string, patch: UpdateVolunteerPatch): Promise<VolunteerRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.phone !== undefined) sets.push(sql`phone = ${patch.phone}`);
  if (patch.skills !== undefined) sets.push(sql`skills = ${textArray(patch.skills)}`);
  if (patch.availability !== undefined) sets.push(sql`availability = ${patch.availability}`);
  if (patch.assignedTask !== undefined) sets.push(sql`assigned_task = ${patch.assignedTask}`);
  if (sets.length === 0) return getVolunteer(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE volunteers SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as VolunteerRow) ?? null;
}

export async function updateAvailability(db: Db, id: string, availability: string): Promise<VolunteerRow | null> {
  const r = await db.execute(sql`
    UPDATE volunteers SET availability = ${availability}, updated_at = now() WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as VolunteerRow) ?? null;
}

/**
 * Available volunteers whose base place shares lineage with `taskPlacePath`
 * (either within it or an ancestor of it) — the bidirectional ltree match
 * used for fan-out matching, same shape as `alerts.repository.ts`'s
 * `findSubscribers`. Optionally filtered by skill (array-contains).
 */
export async function findAvailableNear(
  db: Db,
  taskPlacePath: string,
  f: { skill?: string; limit?: number } = {},
): Promise<VolunteerRow[]> {
  const conds = [
    sql`v.availability = 'available'`,
    sql`(p.path <@ ${taskPlacePath}::ltree OR ${taskPlacePath}::ltree <@ p.path)`,
  ];
  if (f.skill) conds.push(sql`v.skills @> ARRAY[${f.skill}]::text[]`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`v.id`, sql`v.user_id`, sql`v.name`, sql`v.phone`, sql`v.place_id`, sql`v.skills`,
        sql`v.availability`, sql`v.assigned_task`, sql`v.registered_by`, sql`v.created_at`, sql`v.updated_at`,
      ],
      sql`, `,
    )}
    FROM volunteers v JOIN places p ON v.place_id = p.id
    WHERE ${where}
    ORDER BY v.created_at DESC
    LIMIT ${f.limit ?? 10}
  `);
  return r.rows as unknown as VolunteerRow[];
}
