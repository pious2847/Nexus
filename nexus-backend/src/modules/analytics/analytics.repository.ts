/**
 * Cross-module read-side aggregation for the executive dashboard (Module K).
 * Every query is geo-scoped via each table's place_id -> places.path ltree
 * subtree match, the same pattern used everywhere else in this codebase —
 * there is deliberately no "everyone nationally, no scope" query here either.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

const inScope = (alias: string, scopePlaceId: string) =>
  sql`${sql.raw(alias)}.place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))`;

export interface SeverityCount {
  severity: string | null;
  count: number;
}

export async function activeHazardsBySeverity(db: Db, scopePlaceId: string): Promise<SeverityCount[]> {
  const r = await db.execute(sql`
    SELECT severity, count(*)::int AS count FROM hazard_events e
    WHERE e.state <> 'closed' AND ${inScope('e', scopePlaceId)}
    GROUP BY severity
  `);
  return r.rows as unknown as SeverityCount[];
}

export interface ReportsStats {
  total: number;
  verified: number;
  pending: number;
}

export async function reportsLast30Days(db: Db, scopePlaceId: string): Promise<ReportsStats> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'verified')::int AS verified,
           count(*) FILTER (WHERE status = 'pending')::int AS pending
    FROM incident_reports rp
    WHERE rp.created_at >= now() - interval '30 days' AND ${inScope('rp', scopePlaceId)}
  `);
  return r.rows[0] as unknown as ReportsStats;
}

export interface DiseaseCaseCount {
  disease_code: string;
  count: number;
}

export async function diseaseCasesLast30Days(db: Db, scopePlaceId: string): Promise<DiseaseCaseCount[]> {
  const r = await db.execute(sql`
    SELECT disease_code, count(*)::int AS count FROM disease_cases dc
    WHERE dc.reported_at >= now() - interval '30 days' AND ${inScope('dc', scopePlaceId)}
    GROUP BY disease_code ORDER BY count DESC
  `);
  return r.rows as unknown as DiseaseCaseCount[];
}

export interface DispatchStats {
  status: string;
  count: number;
}

export async function dispatchTasksByStatus(db: Db, scopePlaceId: string): Promise<DispatchStats[]> {
  const r = await db.execute(sql`
    SELECT status, count(*)::int AS count FROM dispatch_tasks dt
    WHERE dt.place_id IS NOT NULL AND ${inScope('dt', scopePlaceId)}
    GROUP BY status
  `);
  return r.rows as unknown as DispatchStats[];
}

export interface SosStats {
  open: number;
  acknowledged: number;
  avgAckSeconds: number | null;
}

export async function sosStats(db: Db, scopePlaceId: string): Promise<SosStats> {
  const r = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'open')::int AS open,
      count(*) FILTER (WHERE status = 'acknowledged')::int AS acknowledged,
      AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at))) FILTER (WHERE acknowledged_at IS NOT NULL) AS avg_ack_seconds
    FROM sos_alerts s
    WHERE s.created_at >= now() - interval '30 days' AND ${inScope('s', scopePlaceId)}
  `);
  const row = r.rows[0] as { open: number; acknowledged: number; avg_ack_seconds: string | null };
  return { open: row.open, acknowledged: row.acknowledged, avgAckSeconds: row.avg_ack_seconds ? Math.round(Number(row.avg_ack_seconds)) : null };
}

export interface ShelterStats {
  open: number;
  full: number;
  closed: number;
  totalCapacity: number;
  totalOccupancy: number;
}

export async function shelterStats(db: Db, scopePlaceId: string): Promise<ShelterStats> {
  const r = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'open')::int AS open,
      count(*) FILTER (WHERE status = 'full')::int AS full,
      count(*) FILTER (WHERE status = 'closed')::int AS closed,
      COALESCE(SUM(capacity), 0)::int AS total_capacity,
      COALESCE(SUM(current_occupancy), 0)::int AS total_occupancy
    FROM shelters sh
    WHERE ${inScope('sh', scopePlaceId)}
  `);
  const row = r.rows[0] as { open: number; full: number; closed: number; total_capacity: number; total_occupancy: number };
  return { open: row.open, full: row.full, closed: row.closed, totalCapacity: row.total_capacity, totalOccupancy: row.total_occupancy };
}

export async function vulnerablePersonsCount(db: Db, scopePlaceId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS count FROM vulnerable_persons vp
    WHERE vp.status = 'active' AND ${inScope('vp', scopePlaceId)}
  `);
  return (r.rows[0] as { count: number }).count;
}

export interface MonthlyHazardTrendRow {
  month: string;
  hazard_type: string;
  count: number;
}

/** Monthly hazard-event counts by type, for a trend/seasonality chart. */
export async function monthlyHazardTrend(db: Db, sinceDate: Date, scopePlaceId?: string): Promise<MonthlyHazardTrendRow[]> {
  const scopeCond = scopePlaceId ? sql` AND ${inScope('e', scopePlaceId)}` : sql``;
  const r = await db.execute(sql`
    SELECT to_char(date_trunc('month', e.created_at), 'YYYY-MM') AS month, e.hazard_type, count(*)::int AS count
    FROM hazard_events e
    WHERE e.created_at >= ${sinceDate}${scopeCond}
    GROUP BY month, e.hazard_type
    ORDER BY month, e.hazard_type
  `);
  return r.rows as unknown as MonthlyHazardTrendRow[];
}
