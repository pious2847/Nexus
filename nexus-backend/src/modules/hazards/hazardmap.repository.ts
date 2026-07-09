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
  /** Historical playback (Module H): reconstruct the map as of this past moment,
   *  instead of live "now". See listEventFeaturesAsOf for how this is resolved. */
  asOf?: Date;
}

/** Active (non-closed) hazard events with a geometry — event footprint, else place boundary/centroid. */
export async function listEventFeatures(db: Db, f: EventFeatureFilter): Promise<EventFeatureRow[]> {
  if (f.asOf) return listEventFeaturesAsOf(db, f.asOf, f);

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

/**
 * Historical playback: reconstructs which events were active, and in what
 * state, as of a past moment — by finding each event's most recent
 * transition at or before `asOf` (every event always has at least one
 * transition, the creation row, so this never falls through to a missing
 * state). Events created after `asOf` are excluded entirely (they didn't
 * exist yet); events whose state-as-of-`asOf` was 'closed' are excluded
 * (the map only ever shows non-closed events, live or historical).
 */
async function listEventFeaturesAsOf(db: Db, asOf: Date, f: EventFeatureFilter): Promise<EventFeatureRow[]> {
  const conds = [sql`e.created_at <= ${asOf}`, sql`st.to_state <> 'closed'`];
  if (f.hazardType) conds.push(sql`e.hazard_type = ${f.hazardType}`);
  if (f.severity) conds.push(sql`e.severity = ${f.severity}`);
  if (f.regionId) conds.push(sql`p.path <@ (SELECT path FROM places WHERE id = ${f.regionId})`);
  const where = sql.join(conds, sql` AND `);

  const r = await db.execute(sql`
    WITH state_as_of AS (
      SELECT DISTINCT ON (hazard_event_id) hazard_event_id, to_state, data_snapshot
      FROM event_transitions
      WHERE created_at <= ${asOf}
      ORDER BY hazard_event_id, created_at DESC
    )
    SELECT e.id, e.hazard_type,
           COALESCE((st.data_snapshot->>'severity'), e.severity) AS severity,
           e.color, st.to_state AS state, e.title, e.confidence,
           p.name AS place_name, p.level AS place_level, e.created_at,
           COALESCE(ST_AsGeoJSON(e.geometry), ST_AsGeoJSON(p.boundary), ST_AsGeoJSON(p.centroid)) AS geom_json
    FROM hazard_events e
    JOIN state_as_of st ON st.hazard_event_id = e.id
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
