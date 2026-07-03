/**
 * Data access for citizen incident reports, incl. PostGIS nearby-corroboration.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface IncidentReport {
  id: string;
  reporter_id: string | null;
  reporter_phone: string | null;
  hazard_type: string | null;
  place_id: string | null;
  title: string;
  description: string | null;
  media: unknown;
  status: string;
  confidence: number;
  corroboration_count: number;
  cluster_id: string | null;
  verified_by: string | null;
  promoted_event_id: string | null;
  source: string;
  created_at: string;
}

const COLS = sql`id, reporter_id, reporter_phone, hazard_type, place_id, title, description, media,
  status, confidence, corroboration_count, cluster_id, verified_by, promoted_event_id, source, created_at`;

export interface InsertReportInput {
  reporterId?: string | null;
  reporterPhone?: string | null;
  hazardType?: string | null;
  placeId?: string | null;
  lng?: number | null;
  lat?: number | null;
  title: string;
  description?: string | null;
  media?: unknown;
  confidence: number;
  source: string;
}

export async function insertReport(db: Db, r: InsertReportInput): Promise<IncidentReport> {
  const geom =
    r.lng != null && r.lat != null ? sql`ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)` : sql`NULL`;
  const res = await db.execute(sql`
    INSERT INTO incident_reports (reporter_id, reporter_phone, hazard_type, place_id, geometry,
      title, description, media, confidence, source)
    VALUES (${r.reporterId ?? null}, ${r.reporterPhone ?? null}, ${r.hazardType ?? null}, ${r.placeId ?? null},
      ${geom}, ${r.title}, ${r.description ?? null}, ${JSON.stringify(r.media ?? [])}::jsonb,
      ${r.confidence}, ${r.source})
    RETURNING ${COLS}
  `);
  return res.rows[0] as unknown as IncidentReport;
}

export async function getReport(db: Db, id: string): Promise<IncidentReport | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM incident_reports WHERE id = ${id}`);
  return (r.rows[0] as unknown as IncidentReport) ?? null;
}

export async function listReports(
  db: Db,
  f: { status?: string; hazardType?: string; placeId?: string; limit?: number },
): Promise<IncidentReport[]> {
  const conds = [sql`TRUE`];
  if (f.status) conds.push(sql`status = ${f.status}`);
  if (f.hazardType) conds.push(sql`hazard_type = ${f.hazardType}`);
  if (f.placeId) conds.push(sql`place_id = ${f.placeId}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${COLS} FROM incident_reports WHERE ${where} ORDER BY created_at DESC LIMIT ${f.limit ?? 50}
  `);
  return r.rows as unknown as IncidentReport[];
}

/** Reports of the same hazard type near a point in the recent window (for corroboration). */
export async function findNearbyReports(
  db: Db,
  args: { hazardType: string | null; lng: number; lat: number; km: number; hours: number; excludeId: string },
): Promise<{ id: string; cluster_id: string | null }[]> {
  const typeFilter = args.hazardType ? sql`hazard_type = ${args.hazardType}` : sql`hazard_type IS NULL`;
  const r = await db.execute(sql`
    SELECT id, cluster_id FROM incident_reports
    WHERE id <> ${args.excludeId}
      AND status <> 'rejected'
      AND ${typeFilter}
      AND geometry IS NOT NULL
      AND created_at > now() - make_interval(hours => ${args.hours})
      AND ST_DWithin(geometry::geography, ST_SetSRID(ST_MakePoint(${args.lng}, ${args.lat}), 4326)::geography, ${args.km * 1000})
    ORDER BY created_at
  `);
  return r.rows as unknown as { id: string; cluster_id: string | null }[];
}

export async function assignCluster(db: Db, ids: string[], clusterId: string): Promise<void> {
  if (ids.length === 0) return;
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  await db.execute(sql`UPDATE incident_reports SET cluster_id = ${clusterId} WHERE id IN (${list})`);
}

export async function clusterSize(db: Db, clusterId: string): Promise<number> {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM incident_reports WHERE cluster_id = ${clusterId}`);
  return (r.rows[0] as { n: number }).n;
}

/** Set corroboration_count + confidence for all reports in a cluster. */
export async function updateClusterConfidence(db: Db, clusterId: string, size: number, confidence: number): Promise<void> {
  await db.execute(sql`
    UPDATE incident_reports SET corroboration_count = ${size}, confidence = ${confidence}, updated_at = now()
    WHERE cluster_id = ${clusterId}
  `);
}

export async function setVerification(
  db: Db,
  args: { id: string; status: 'verified' | 'rejected'; reviewerId: string; reason?: string | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE incident_reports SET status = ${args.status}, verified_by = ${args.reviewerId}, verified_at = now(),
      rejection_reason = ${args.reason ?? null}, updated_at = now()
    WHERE id = ${args.id}
  `);
}

export async function setPromoted(db: Db, id: string, eventId: string): Promise<void> {
  await db.execute(sql`
    UPDATE incident_reports SET status = 'promoted', promoted_event_id = ${eventId}, updated_at = now() WHERE id = ${id}
  `);
}

export async function getReportPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM incident_reports r JOIN places p ON r.place_id = p.id WHERE r.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

// ── reporter reputation ──
export async function getReputation(db: Db, userId: string): Promise<number> {
  const r = await db.execute(sql`SELECT reputation_score FROM users WHERE id = ${userId}`);
  return (r.rows[0] as { reputation_score: number } | undefined)?.reputation_score ?? 0;
}

export async function setReputation(db: Db, userId: string, score: number): Promise<void> {
  await db.execute(sql`UPDATE users SET reputation_score = ${score}, updated_at = now() WHERE id = ${userId}`);
}
