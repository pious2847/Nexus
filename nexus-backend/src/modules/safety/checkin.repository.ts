/**
 * Data access for "I'm Safe" check-ins (spec 02 N1, Module N).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface CheckinRow {
  id: string;
  hazard_event_id: string | null;
  place_id: string;
  status: string;
  subject_name: string | null;
  reporter_phone: string | null;
  reported_by: string | null;
  source: string;
  notes: string | null;
  created_at: string;
}

const COLS = sql`id, hazard_event_id, place_id, status, subject_name, reporter_phone,
  reported_by, source, notes, created_at`;

export interface InsertCheckinInput {
  hazardEventId?: string | null;
  placeId: string;
  status: string;
  subjectName?: string | null;
  reporterPhone?: string | null;
  reportedBy?: string | null;
  source: string;
  notes?: string | null;
}

export async function insertCheckin(db: Db, c: InsertCheckinInput): Promise<CheckinRow> {
  const r = await db.execute(sql`
    INSERT INTO safety_checkins (hazard_event_id, place_id, status, subject_name, reporter_phone, reported_by, source, notes)
    VALUES (${c.hazardEventId ?? null}, ${c.placeId}, ${c.status}, ${c.subjectName ?? null},
      ${c.reporterPhone ?? null}, ${c.reportedBy ?? null}, ${c.source}, ${c.notes ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as CheckinRow;
}

/**
 * The most recent non-terminal hazard event whose affected place is an
 * ancestor of (or the same as) the check-in's place — i.e. the event covers
 * this location. Lets a citizen text "SAFE, Tolon" without knowing an event
 * ID; if no open event covers the place, the check-in is still recorded
 * (hazard_event_id null) rather than rejected.
 */
export async function findActiveEventForPlace(db: Db, placeId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT e.id FROM hazard_events e
    JOIN places ep ON e.place_id = ep.id
    JOIN places cp ON cp.id = ${placeId}
    WHERE e.state != 'closed' AND cp.path <@ ep.path
    ORDER BY e.created_at DESC
    LIMIT 1
  `);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

export async function listByEvent(db: Db, hazardEventId: string): Promise<CheckinRow[]> {
  const r = await db.execute(sql`SELECT ${COLS} FROM safety_checkins WHERE hazard_event_id = ${hazardEventId} ORDER BY created_at DESC`);
  return r.rows as unknown as CheckinRow[];
}

export interface CheckinSummary {
  status: string;
  count: number;
}

/** Aggregated counts per status for a hazard event — the "who's unaccounted for" view. */
export async function summaryByEvent(db: Db, hazardEventId: string): Promise<CheckinSummary[]> {
  const r = await db.execute(sql`
    SELECT status, COUNT(*)::int AS count FROM safety_checkins
    WHERE hazard_event_id = ${hazardEventId}
    GROUP BY status
  `);
  return r.rows as unknown as CheckinSummary[];
}

/** Same as listByEvent, but scoped to a geography subtree instead of one event (e.g. a district-wide view). */
export async function listByScope(db: Db, scopePlaceId: string, filter: { status?: string } = {}): Promise<CheckinRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (filter.status) conds.push(sql`c.status = ${filter.status}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`c.id`, sql`c.hazard_event_id`, sql`c.place_id`, sql`c.status`, sql`c.subject_name`,
        sql`c.reporter_phone`, sql`c.reported_by`, sql`c.source`, sql`c.notes`, sql`c.created_at`,
      ],
      sql`, `,
    )}
    FROM safety_checkins c JOIN places p ON c.place_id = p.id
    WHERE ${where}
    ORDER BY c.created_at DESC
  `);
  return r.rows as unknown as CheckinRow[];
}
