/**
 * Data access for the response-asset registry (vehicles, boats, equipment —
 * Module M). Same CRUD-registry shape as `health-facility.repository.ts` /
 * `volunteer.repository.ts`: ltree subtree scoping via `path <@`.
 *
 * DDL: src/db/migrations/0018_emergency_response.sql (response_assets table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface ResponseAssetRow {
  id: string;
  name: string;
  asset_type: string;
  place_id: string;
  status: string;
  assigned_task: string | null;
  notes: string | null;
  registered_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, name, asset_type, place_id, status, assigned_task, notes, registered_by, created_at, updated_at`;

export interface InsertAssetInput {
  name: string;
  assetType: string;
  placeId: string;
  notes?: string | null;
  registeredBy?: string | null;
}

export async function insertAsset(db: Db, a: InsertAssetInput): Promise<ResponseAssetRow> {
  const r = await db.execute(sql`
    INSERT INTO response_assets (name, asset_type, place_id, notes, registered_by)
    VALUES (${a.name}, ${a.assetType}, ${a.placeId}, ${a.notes ?? null}, ${a.registeredBy ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as ResponseAssetRow;
}

export async function getAsset(db: Db, id: string): Promise<ResponseAssetRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM response_assets WHERE id = ${id}`);
  return (r.rows[0] as unknown as ResponseAssetRow) ?? null;
}

/** ltree path of the asset's base place, for RBAC scope checks. */
export async function getAssetPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM response_assets a JOIN places p ON a.place_id = p.id WHERE a.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

/** List assets within a geography subtree (the scope place and everything under it). */
export async function listByScope(
  db: Db,
  scopePlaceId: string,
  f: { status?: string; assetType?: string } = {},
): Promise<ResponseAssetRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.status) conds.push(sql`a.status = ${f.status}`);
  if (f.assetType) conds.push(sql`a.asset_type = ${f.assetType}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`a.id`, sql`a.name`, sql`a.asset_type`, sql`a.place_id`, sql`a.status`,
        sql`a.assigned_task`, sql`a.notes`, sql`a.registered_by`, sql`a.created_at`, sql`a.updated_at`,
      ],
      sql`, `,
    )}
    FROM response_assets a JOIN places p ON a.place_id = p.id
    WHERE ${where}
    ORDER BY a.created_at DESC
  `);
  return r.rows as unknown as ResponseAssetRow[];
}

export interface UpdateAssetPatch {
  name?: string;
  assetType?: string;
  status?: string;
  assignedTask?: string | null;
  notes?: string | null;
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateAsset(db: Db, id: string, patch: UpdateAssetPatch): Promise<ResponseAssetRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.assetType !== undefined) sets.push(sql`asset_type = ${patch.assetType}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.assignedTask !== undefined) sets.push(sql`assigned_task = ${patch.assignedTask}`);
  if (patch.notes !== undefined) sets.push(sql`notes = ${patch.notes}`);
  if (sets.length === 0) return getAsset(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE response_assets SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as ResponseAssetRow) ?? null;
}
