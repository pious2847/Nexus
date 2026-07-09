/**
 * Data access for official myth-vs-fact clarifications (Module N — N11
 * Rumor & misinformation control). Mirrors rumor.repository.ts's style.
 * This is a public feed (citizens read published clarifications with no
 * auth), so unlike rumor_reports, scope filtering here is OPTIONAL —
 * omitting it returns the most recent entries nationally.
 *
 * DDL: src/db/migrations/0019_missing_persons_rumor_anticipatory.sql
 * (myth_fact_entries table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface MythFactEntryRow {
  id: string;
  hazard_event_id: string | null;
  place_id: string | null;
  myth: string;
  fact: string;
  rumor_report_id: string | null;
  published_by: string;
  channels_notified: unknown;
  created_at: string;
}

const COLS = sql`id, hazard_event_id, place_id, myth, fact, rumor_report_id, published_by, channels_notified, created_at`;

export interface InsertMythFactInput {
  hazardEventId?: string | null;
  placeId?: string | null;
  myth: string;
  fact: string;
  rumorReportId?: string | null;
  publishedBy: string;
}

export async function insertMythFact(db: Db, p: InsertMythFactInput): Promise<MythFactEntryRow> {
  const r = await db.execute(sql`
    INSERT INTO myth_fact_entries (hazard_event_id, place_id, myth, fact, rumor_report_id, published_by)
    VALUES (
      ${p.hazardEventId ?? null}, ${p.placeId ?? null}, ${p.myth}, ${p.fact},
      ${p.rumorReportId ?? null}, ${p.publishedBy}
    )
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as MythFactEntryRow;
}

export async function getMythFact(db: Db, id: string): Promise<MythFactEntryRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM myth_fact_entries WHERE id = ${id}`);
  return (r.rows[0] as unknown as MythFactEntryRow) ?? null;
}

/**
 * Public clarification feed. If `scopePlaceId` is given, restrict to entries
 * whose place_id is within that subtree (nationally-scoped entries with a
 * NULL place_id are excluded from a scoped query, same NULL-`IN` semantics
 * as rumor.repository.ts). If omitted, return the most recent `limit`
 * entries nationwide, regardless of place.
 */
export async function listMythFactsByScope(
  db: Db,
  scopePlaceId?: string | null,
  limit = 50,
): Promise<MythFactEntryRow[]> {
  if (scopePlaceId) {
    const r = await db.execute(sql`
      SELECT ${COLS} FROM myth_fact_entries
      WHERE place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return r.rows as unknown as MythFactEntryRow[];
  }
  const r = await db.execute(sql`
    SELECT ${COLS} FROM myth_fact_entries ORDER BY created_at DESC LIMIT ${limit}
  `);
  return r.rows as unknown as MythFactEntryRow[];
}

/** Overwrite the fan-out summary (e.g. `{ focalPointsNotified: 3 }`) recorded against a published entry. */
export async function setChannelsNotified(db: Db, id: string, summary: Record<string, unknown>): Promise<MythFactEntryRow | null> {
  const r = await db.execute(sql`
    UPDATE myth_fact_entries SET channels_notified = ${JSON.stringify(summary)}::jsonb WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as MythFactEntryRow) ?? null;
}
