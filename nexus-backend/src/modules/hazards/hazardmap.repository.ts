/**
 * Data access for the national multi-hazard map. Two views over the same
 * `hazard_events`: raw event features (points/footprints) and a per-district
 * risk aggregation (choropleth) computed over the geography subtree (ltree).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface EventFeatureRow {
  id: string;
  hazard_type: string;
  severity: string | null;
  color: string | null;
  state: string;
  title: string;
  confidence: number | null;
  place_name: string | null;
  place_level: string | null;
  created_at: string;
  geom_json: string | null;
}

export interface EventFeatureFilter {
  hazardType?: string;
  severity?: string;
  regionId?: string; // restrict to a region's subtree
  limit?: number;
}

/** Active (non-closed) hazard events with a geometry — event footprint, else place boundary/centroid. */
export async function listEventFeatures(db: Db, f: EventFeatureFilter): Promise<EventFeatureRow[]> {
  const conds = [sql`e.state <> 'closed'`];
  if (f.hazardType) conds.push(sql`e.hazard_type = ${f.hazardType}`);
  if (f.severity) conds.push(sql`e.severity = ${f.severity}`);
  if (f.regionId) conds.push(sql`p.path <@ (SELECT path FROM places WHERE id = ${f.regionId})`);
  const where = sql.join(conds, sql` AND `);

  const r = await db.execute(sql`
    SELECT e.id, e.hazard_type, e.severity, e.color, e.state, e.title, e.confidence,
           p.name AS place_name, p.level AS place_level, e.created_at,
           COALESCE(ST_AsGeoJSON(e.geometry), ST_AsGeoJSON(p.boundary), ST_AsGeoJSON(p.centroid)) AS geom_json
    FROM hazard_events e
    LEFT JOIN places p ON e.place_id = p.id
    WHERE ${where}
    ORDER BY e.created_at DESC
    LIMIT ${f.limit ?? 500}
  `);
  return r.rows as unknown as EventFeatureRow[];
}

export interface DistrictRiskRow {
  id: string;
  name: string;
  geom_json: string | null;
  max_rank: number | null;
  hazard_types: string[] | null; // distinct active hazard types affecting this district
}

/**
 * Per-district worst-case active severity, aggregated over the geography subtree:
 * an event raised at a region counts for every district inside it (ltree `path <@`).
 */
export async function listDistrictRisk(db: Db): Promise<DistrictRiskRow[]> {
  const r = await db.execute(sql`
    WITH district AS (
      SELECT id, name, path, boundary FROM places WHERE level = 'district'
    ),
    active AS (
      SELECT p.path AS event_path, e.hazard_type,
        CASE e.severity WHEN 'extreme' THEN 4 WHEN 'severe' THEN 3 WHEN 'moderate' THEN 2 WHEN 'minor' THEN 1 ELSE 0 END AS rank
      FROM hazard_events e JOIN places p ON e.place_id = p.id
      WHERE e.state <> 'closed'
    )
    SELECT d.id, d.name, ST_AsGeoJSON(d.boundary) AS geom_json,
           MAX(a.rank) AS max_rank,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.hazard_type) FILTER (WHERE a.rank IS NOT NULL), NULL) AS hazard_types
    FROM district d
    LEFT JOIN active a ON d.path <@ a.event_path
    GROUP BY d.id, d.name, d.boundary
    ORDER BY d.name
  `);
  return r.rows as unknown as DistrictRiskRow[];
}

export interface NationalSummaryRow {
  hazard_type: string;
  severity: string | null;
  count: number;
}

/** National counts of active events by hazard type + severity, for a dashboard header. */
export async function nationalSummary(db: Db): Promise<NationalSummaryRow[]> {
  const r = await db.execute(sql`
    SELECT hazard_type, severity, count(*)::int AS count
    FROM hazard_events WHERE state <> 'closed'
    GROUP BY hazard_type, severity
    ORDER BY hazard_type, severity
  `);
  return r.rows as unknown as NationalSummaryRow[];
}
