/**
 * Data access for rapid post-event damage & needs assessments (spec 02 N15).
 * Structured field-submitted assessments (households/persons affected,
 * casualties, damage, urgent needs), geo-tagged, rolling up into a situation
 * report via aggregation — no separate sitrep table (mirrors the design note
 * in the migration comment). Follows shelter.repository.ts's conventions
 * (Drizzle `sql` tag, ltree subtree scope checks) and sos.repository.ts's
 * geometry select-back pattern (`ST_X(geometry) AS lng, ST_Y(geometry) AS lat`).
 *
 * DDL: src/db/migrations/0021_damage_assessments_facility_capacity.sql
 * (damage_assessments table).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

/**
 * Build a `text[]` SQL fragment from a JS array. Needed because drizzle expands
 * a bare array param into a tuple, which can't be cast to text[] (mirrors
 * shelter.repository.ts's textArray()).
 */
function textArray(values: string[] | null | undefined) {
  if (values == null) return sql`NULL`;
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export interface DamageAssessmentRow {
  id: string;
  place_id: string;
  hazard_event_id: string | null;
  lng: number | null;
  lat: number | null;
  households_affected: number;
  persons_affected: number;
  casualties: number;
  injuries: number;
  infrastructure_damage: string | null;
  urgent_needs: string[];
  media: unknown;
  notes: string | null;
  assessed_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, hazard_event_id, ST_X(geometry) AS lng, ST_Y(geometry) AS lat,
  households_affected, persons_affected, casualties, injuries, infrastructure_damage,
  urgent_needs, media, notes, assessed_by, created_at, updated_at`;

export interface InsertAssessmentInput {
  placeId: string;
  hazardEventId?: string | null;
  lng?: number | null;
  lat?: number | null;
  householdsAffected?: number;
  personsAffected?: number;
  casualties?: number;
  injuries?: number;
  infrastructureDamage?: string | null;
  urgentNeeds?: string[];
  media?: unknown;
  notes?: string | null;
  assessedBy?: string | null;
}

export async function insertAssessment(db: Db, p: InsertAssessmentInput): Promise<DamageAssessmentRow> {
  const geom = p.lng != null && p.lat != null ? sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)` : sql`NULL`;
  const r = await db.execute(sql`
    INSERT INTO damage_assessments (
      place_id, hazard_event_id, geometry, households_affected, persons_affected, casualties, injuries,
      infrastructure_damage, urgent_needs, media, notes, assessed_by
    )
    VALUES (
      ${p.placeId}, ${p.hazardEventId ?? null}, ${geom}, ${p.householdsAffected ?? 0}, ${p.personsAffected ?? 0},
      ${p.casualties ?? 0}, ${p.injuries ?? 0}, ${p.infrastructureDamage ?? null},
      ${textArray(p.urgentNeeds ?? [])}, ${JSON.stringify(p.media ?? [])}::jsonb, ${p.notes ?? null}, ${p.assessedBy ?? null}
    )
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as DamageAssessmentRow;
}

export async function getAssessment(db: Db, id: string): Promise<DamageAssessmentRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM damage_assessments WHERE id = ${id}`);
  return (r.rows[0] as unknown as DamageAssessmentRow) ?? null;
}

/** ltree path of the assessment's place, for RBAC scope checks (mirrors getShelterPlacePath). */
export async function assessmentPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM damage_assessments a JOIN places p ON a.place_id = p.id WHERE a.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface ListAssessmentFilter {
  hazardEventId?: string;
}

/** List assessments within a geography subtree (the scope place and everything under it). */
export async function listAssessmentsByScope(
  db: Db,
  scopePlaceId: string,
  f: ListAssessmentFilter = {},
): Promise<DamageAssessmentRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.hazardEventId) conds.push(sql`a.hazard_event_id = ${f.hazardEventId}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`a.id`, sql`a.place_id`, sql`a.hazard_event_id`, sql`ST_X(a.geometry) AS lng`, sql`ST_Y(a.geometry) AS lat`,
        sql`a.households_affected`, sql`a.persons_affected`, sql`a.casualties`, sql`a.injuries`,
        sql`a.infrastructure_damage`, sql`a.urgent_needs`, sql`a.media`, sql`a.notes`, sql`a.assessed_by`,
        sql`a.created_at`, sql`a.updated_at`,
      ],
      sql`, `,
    )}
    FROM damage_assessments a JOIN places p ON a.place_id = p.id
    WHERE ${where}
    ORDER BY a.created_at DESC
  `);
  return r.rows as unknown as DamageAssessmentRow[];
}

export interface UrgentNeedBreakdown {
  need: string;
  count: number;
}

export interface SituationReport {
  scopePlaceId: string;
  hazardEventId: string | null;
  totalAssessments: number;
  householdsAffected: number;
  personsAffected: number;
  casualties: number;
  injuries: number;
  urgentNeeds: UrgentNeedBreakdown[];
}

/**
 * The "auto-rolls up into a situation report" aggregation — sums across every
 * assessment within a geography subtree (optionally filtered to one hazard
 * event), plus an urgent-needs breakdown. No separate stored document; this
 * is computed fresh on each request.
 */
export async function situationReport(
  db: Db,
  scopePlaceId: string,
  hazardEventId?: string,
): Promise<SituationReport> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (hazardEventId) conds.push(sql`a.hazard_event_id = ${hazardEventId}`);
  const where = sql.join(conds, sql` AND `);

  const totalsR = await db.execute(sql`
    SELECT
      count(*) AS total_assessments,
      COALESCE(SUM(a.households_affected), 0) AS households_affected,
      COALESCE(SUM(a.persons_affected), 0) AS persons_affected,
      COALESCE(SUM(a.casualties), 0) AS casualties,
      COALESCE(SUM(a.injuries), 0) AS injuries
    FROM damage_assessments a JOIN places p ON a.place_id = p.id
    WHERE ${where}
  `);
  const totals = totalsR.rows[0] as {
    total_assessments: string | number;
    households_affected: string | number;
    persons_affected: string | number;
    casualties: string | number;
    injuries: string | number;
  };

  const needsR = await db.execute(sql`
    SELECT unnest(a.urgent_needs) AS need, count(*) AS count
    FROM damage_assessments a JOIN places p ON a.place_id = p.id
    WHERE ${where}
    GROUP BY need
    ORDER BY count DESC
  `);
  const urgentNeeds = (needsR.rows as { need: string; count: string | number }[]).map((row) => ({
    need: row.need,
    count: Number(row.count),
  }));

  return {
    scopePlaceId,
    hazardEventId: hazardEventId ?? null,
    totalAssessments: Number(totals.total_assessments),
    householdsAffected: Number(totals.households_affected),
    personsAffected: Number(totals.persons_affected),
    casualties: Number(totals.casualties),
    injuries: Number(totals.injuries),
    urgentNeeds,
  };
}
