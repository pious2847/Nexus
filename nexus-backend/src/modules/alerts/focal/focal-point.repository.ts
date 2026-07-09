/**
 * Data access for community focal points (spec 02 N6, Module F last-mile channels).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface FocalPointRow {
  id: string;
  place_id: string;
  name: string;
  relay_method: string;
  station_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  active: boolean;
  registered_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, name, relay_method, station_name, contact_phone, contact_email,
  notes, active, registered_by, created_at, updated_at`;

export interface InsertFocalPointInput {
  placeId: string;
  name: string;
  relayMethod: string;
  stationName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  registeredBy: string;
}

export async function insertFocalPoint(db: Db, f: InsertFocalPointInput): Promise<FocalPointRow> {
  const r = await db.execute(sql`
    INSERT INTO community_focal_points (place_id, name, relay_method, station_name, contact_phone, contact_email, notes, registered_by)
    VALUES (${f.placeId}, ${f.name}, ${f.relayMethod}, ${f.stationName ?? null}, ${f.contactPhone ?? null},
      ${f.contactEmail ?? null}, ${f.notes ?? null}, ${f.registeredBy})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as FocalPointRow;
}

export async function getFocalPoint(db: Db, id: string): Promise<FocalPointRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM community_focal_points WHERE id = ${id}`);
  return (r.rows[0] as unknown as FocalPointRow) ?? null;
}

export async function getFocalPointPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM community_focal_points f JOIN places p ON f.place_id = p.id WHERE f.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export async function listByScope(
  db: Db,
  scopePlaceId: string,
  filter: { relayMethod?: string; active?: boolean } = {},
): Promise<FocalPointRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (filter.relayMethod) conds.push(sql`f.relay_method = ${filter.relayMethod}`);
  if (filter.active !== undefined) conds.push(sql`f.active = ${filter.active}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`f.id`, sql`f.place_id`, sql`f.name`, sql`f.relay_method`, sql`f.station_name`,
        sql`f.contact_phone`, sql`f.contact_email`, sql`f.notes`, sql`f.active`,
        sql`f.registered_by`, sql`f.created_at`, sql`f.updated_at`,
      ],
      sql`, `,
    )}
    FROM community_focal_points f JOIN places p ON f.place_id = p.id
    WHERE ${where}
    ORDER BY f.created_at DESC
  `);
  return r.rows as unknown as FocalPointRow[];
}

export interface UpdateFocalPointPatch {
  name?: string;
  relayMethod?: string;
  stationName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  active?: boolean;
}

export async function updateFocalPoint(db: Db, id: string, patch: UpdateFocalPointPatch): Promise<FocalPointRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.relayMethod !== undefined) sets.push(sql`relay_method = ${patch.relayMethod}`);
  if (patch.stationName !== undefined) sets.push(sql`station_name = ${patch.stationName}`);
  if (patch.contactPhone !== undefined) sets.push(sql`contact_phone = ${patch.contactPhone}`);
  if (patch.contactEmail !== undefined) sets.push(sql`contact_email = ${patch.contactEmail}`);
  if (patch.notes !== undefined) sets.push(sql`notes = ${patch.notes}`);
  if (patch.active !== undefined) sets.push(sql`active = ${patch.active}`);
  if (sets.length === 0) return getFocalPoint(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE community_focal_points SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as FocalPointRow) ?? null;
}

/** Active focal points within a geography subtree — used by the alert dissemination fan-out. */
export async function findActiveByScope(db: Db, placePath: string): Promise<FocalPointRow[]> {
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`f.id`, sql`f.place_id`, sql`f.name`, sql`f.relay_method`, sql`f.station_name`,
        sql`f.contact_phone`, sql`f.contact_email`, sql`f.notes`, sql`f.active`,
        sql`f.registered_by`, sql`f.created_at`, sql`f.updated_at`,
      ],
      sql`, `,
    )}
    FROM community_focal_points f JOIN places p ON f.place_id = p.id
    WHERE (p.path <@ ${placePath}::ltree OR ${placePath}::ltree <@ p.path) AND f.active = true
  `);
  return r.rows as unknown as FocalPointRow[];
}
