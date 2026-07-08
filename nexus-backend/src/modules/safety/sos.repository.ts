/**
 * Data access for SOS / panic-button alerts (spec 02 N2, Module N).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface SosAlertRow {
  id: string;
  place_id: string | null;
  lng: number;
  lat: number;
  location_precision: string;
  status: string;
  danger_type: string | null;
  notes: string | null;
  reporter_phone: string | null;
  reported_by: string | null;
  responders_notified: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, ST_X(geometry) AS lng, ST_Y(geometry) AS lat, location_precision, status,
  danger_type, notes, reporter_phone, reported_by, responders_notified,
  acknowledged_by, acknowledged_at, resolved_by, resolved_at, created_at, updated_at`;

export interface InsertSosInput {
  placeId: string | null;
  lng: number;
  lat: number;
  locationPrecision: 'gps' | 'district_centroid';
  dangerType?: string | null;
  notes?: string | null;
  reporterPhone?: string | null;
  reportedBy?: string | null;
}

export async function insertSos(db: Db, s: InsertSosInput): Promise<SosAlertRow> {
  const r = await db.execute(sql`
    INSERT INTO sos_alerts (place_id, geometry, location_precision, danger_type, notes, reporter_phone, reported_by)
    VALUES (${s.placeId}, ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326), ${s.locationPrecision},
      ${s.dangerType ?? null}, ${s.notes ?? null}, ${s.reporterPhone ?? null}, ${s.reportedBy ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as SosAlertRow;
}

export async function getSos(db: Db, id: string): Promise<SosAlertRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM sos_alerts WHERE id = ${id}`);
  return (r.rows[0] as unknown as SosAlertRow) ?? null;
}

/** A place's representative centroid — used for SMS-originated SOS (no live GPS available over SMS). */
export async function getPlaceCentroid(db: Db, placeId: string): Promise<{ lng: number; lat: number } | null> {
  const r = await db.execute(sql`
    SELECT ST_X(centroid::geometry) AS lng, ST_Y(centroid::geometry) AS lat FROM places WHERE id = ${placeId} AND centroid IS NOT NULL
  `);
  return (r.rows[0] as { lng: number; lat: number } | undefined) ?? null;
}

export async function getSosPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM sos_alerts s JOIN places p ON s.place_id = p.id WHERE s.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export async function setNotifiedCount(db: Db, id: string, count: number): Promise<void> {
  await db.execute(sql`UPDATE sos_alerts SET responders_notified = ${count}, updated_at = now() WHERE id = ${id}`);
}

export async function acknowledge(db: Db, id: string, actorId: string): Promise<void> {
  await db.execute(sql`
    UPDATE sos_alerts SET status = 'acknowledged', acknowledged_by = ${actorId}, acknowledged_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'open'
  `);
}

export async function resolve(db: Db, id: string, actorId: string, status: 'resolved' | 'false_alarm'): Promise<void> {
  await db.execute(sql`
    UPDATE sos_alerts SET status = ${status}, resolved_by = ${actorId}, resolved_at = now(), updated_at = now()
    WHERE id = ${id}
  `);
}

/** Open/acknowledged SOS alerts within a geography subtree, most urgent (oldest open) first. */
export async function listActiveByScope(db: Db, scopePlaceId: string): Promise<SosAlertRow[]> {
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`s.id`, sql`s.place_id`, sql`ST_X(s.geometry) AS lng`, sql`ST_Y(s.geometry) AS lat`,
        sql`s.location_precision`, sql`s.status`, sql`s.danger_type`, sql`s.notes`, sql`s.reporter_phone`,
        sql`s.reported_by`, sql`s.responders_notified`, sql`s.acknowledged_by`, sql`s.acknowledged_at`,
        sql`s.resolved_by`, sql`s.resolved_at`, sql`s.created_at`, sql`s.updated_at`,
      ],
      sql`, `,
    )}
    FROM sos_alerts s JOIN places p ON s.place_id = p.id
    WHERE p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})
      AND s.status IN ('open', 'acknowledged')
    ORDER BY s.created_at ASC
  `);
  return r.rows as unknown as SosAlertRow[];
}

export interface ResponderCandidate {
  userId: string;
  phone: string | null;
  role: string;
}

/**
 * Candidate responders for a place: users whose role grant is national
 * (place_id IS NULL) or whose scope is an ancestor of (or equal to) the
 * place. Returns every geo-eligible role — the caller filters by
 * `roleHasPermission(role, 'sos.manage')` (pure logic, no DB) so this stays
 * a plain data-access query.
 */
export async function findResponderCandidates(db: Db, placePath: string): Promise<ResponderCandidate[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id, u.phone, ur.role_code AS role
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    LEFT JOIN places p ON ur.place_id = p.id
    WHERE (ur.place_id IS NULL OR ${placePath}::ltree <@ p.path)
  `);
  return (r.rows as { user_id: string; phone: string | null; role: string }[]).map((row) => ({
    userId: row.user_id,
    phone: row.phone,
    role: row.role,
  }));
}
