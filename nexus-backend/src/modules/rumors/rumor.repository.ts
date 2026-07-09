/**
 * Data access for rumor intake (Module N — N11 Rumor & misinformation
 * control). Mirrors shelter.repository.ts's style (Drizzle `sql` tag, ltree
 * subtree scope checks via `listRumorsByScope`). Unlike shelters, `place_id`
 * is NULLABLE here — a rumor can be phoned in without a resolvable location —
 * so scoped listing naturally excludes unscoped rumors (SQL `IN` never
 * matches a NULL column) and `rumorPlacePath` returns null for them, which
 * `rbac.can()` treats as "requires national-level permission".
 *
 * DDL: src/db/migrations/0019_missing_persons_rumor_anticipatory.sql
 * (rumor_reports table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface RumorReportRow {
  id: string;
  place_id: string | null;
  hazard_event_id: string | null;
  description: string;
  source: string | null;
  reporter_id: string | null;
  reporter_phone: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, hazard_event_id, description, source, reporter_id, reporter_phone, status, reviewed_by, reviewed_at, resolution_notes, created_at, updated_at`;

export interface InsertRumorReportInput {
  placeId?: string | null;
  hazardEventId?: string | null;
  description: string;
  source?: string | null;
  reporterId?: string | null;
  reporterPhone?: string | null;
}

export async function insertRumorReport(db: Db, p: InsertRumorReportInput): Promise<RumorReportRow> {
  const r = await db.execute(sql`
    INSERT INTO rumor_reports (place_id, hazard_event_id, description, source, reporter_id, reporter_phone)
    VALUES (
      ${p.placeId ?? null}, ${p.hazardEventId ?? null}, ${p.description}, ${p.source ?? null},
      ${p.reporterId ?? null}, ${p.reporterPhone ?? null}
    )
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as RumorReportRow;
}

export async function getRumorReport(db: Db, id: string): Promise<RumorReportRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM rumor_reports WHERE id = ${id}`);
  return (r.rows[0] as unknown as RumorReportRow) ?? null;
}

/**
 * ltree path of the rumor's place, for RBAC scope checks (mirrors
 * getShelterPlacePath). Returns null both when the rumor has no id match
 * AND when its place_id is null — an unscoped rumor requires national-level
 * `rumor.manage`/`rumor.read`, which `rbac.can(userId, perm, null)` enforces.
 */
export async function rumorPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM rumor_reports rr JOIN places p ON rr.place_id = p.id WHERE rr.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface ListRumorFilter {
  status?: string;
}

/**
 * List rumors within a geography subtree (the scope place and everything
 * under it). Rumors with a NULL place_id are never returned here — `IN`
 * against a NULL column never matches, so unscoped rumors can only be
 * fetched by id.
 */
export async function listRumorsByScope(db: Db, scopePlaceId: string, f: ListRumorFilter = {}): Promise<RumorReportRow[]> {
  const conds = [
    sql`place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))`,
  ];
  if (f.status) conds.push(sql`status = ${f.status}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${COLS} FROM rumor_reports WHERE ${where} ORDER BY created_at DESC
  `);
  return r.rows as unknown as RumorReportRow[];
}

export interface UpdateRumorReportPatch {
  status?: string;
  reviewedBy?: string | null;
  reviewedAt?: Date | string | null;
  resolutionNotes?: string | null;
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateRumorReport(db: Db, id: string, patch: UpdateRumorReportPatch): Promise<RumorReportRow | null> {
  const sets = [];
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.reviewedBy !== undefined) sets.push(sql`reviewed_by = ${patch.reviewedBy}`);
  if (patch.reviewedAt !== undefined) sets.push(sql`reviewed_at = ${patch.reviewedAt}`);
  if (patch.resolutionNotes !== undefined) sets.push(sql`resolution_notes = ${patch.resolutionNotes}`);
  if (sets.length === 0) return getRumorReport(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE rumor_reports SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as RumorReportRow) ?? null;
}
