/**
 * Data access for disease case reporting + the disease-type registry
 * (Module D). Epi-aggregate only — no patient names/identifiers, so unlike
 * vulnerable_persons this is not itself sensitive PII, but it is still
 * geo-scoped (listByScope) for the same operational reasons as every other
 * geo-scoped registry in this codebase.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface DiseaseCaseRow {
  id: string;
  disease_code: string;
  place_id: string;
  facility_id: string | null;
  case_status: string;
  source: string;
  age_group: string | null;
  sex: string | null;
  reported_by: string | null;
  onset_date: string | null;
  reported_at: string;
  notes: string | null;
  created_at: string;
}

const COLS = sql`id, disease_code, place_id, facility_id, case_status, source, age_group, sex,
  reported_by, onset_date, reported_at, notes, created_at`;

export interface InsertDiseaseCaseInput {
  diseaseCode: string;
  placeId: string;
  facilityId?: string | null;
  caseStatus: string;
  source: string;
  ageGroup?: string | null;
  sex?: string | null;
  reportedBy?: string | null;
  onsetDate?: string | null;
  notes?: string | null;
}

export async function insertCase(db: Db, c: InsertDiseaseCaseInput): Promise<DiseaseCaseRow> {
  const r = await db.execute(sql`
    INSERT INTO disease_cases (disease_code, place_id, facility_id, case_status, source, age_group, sex,
      reported_by, onset_date, notes)
    VALUES (${c.diseaseCode}, ${c.placeId}, ${c.facilityId ?? null}, ${c.caseStatus}, ${c.source},
      ${c.ageGroup ?? null}, ${c.sex ?? null}, ${c.reportedBy ?? null}, ${c.onsetDate ?? null}, ${c.notes ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as DiseaseCaseRow;
}

export async function getCase(db: Db, id: string): Promise<DiseaseCaseRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM disease_cases WHERE id = ${id}`);
  return (r.rows[0] as unknown as DiseaseCaseRow) ?? null;
}

export async function getCasePlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM disease_cases c JOIN places p ON c.place_id = p.id WHERE c.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

/** List cases within a geography subtree (the scope place and everything under it). */
export async function listByScope(
  db: Db,
  scopePlaceId: string,
  f: { diseaseCode?: string; caseStatus?: string; from?: string; to?: string } = {},
): Promise<DiseaseCaseRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.diseaseCode) conds.push(sql`c.disease_code = ${f.diseaseCode}`);
  if (f.caseStatus) conds.push(sql`c.case_status = ${f.caseStatus}`);
  if (f.from) conds.push(sql`c.reported_at >= ${f.from}`);
  if (f.to) conds.push(sql`c.reported_at < ${f.to}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`c.id`, sql`c.disease_code`, sql`c.place_id`, sql`c.facility_id`, sql`c.case_status`, sql`c.source`,
        sql`c.age_group`, sql`c.sex`, sql`c.reported_by`, sql`c.onset_date`, sql`c.reported_at`, sql`c.notes`, sql`c.created_at`,
      ],
      sql`, `,
    )}
    FROM disease_cases c JOIN places p ON c.place_id = p.id
    WHERE ${where}
    ORDER BY c.reported_at DESC
  `);
  return r.rows as unknown as DiseaseCaseRow[];
}

/**
 * Count of cases for a disease in an exact place (not subtree) within a
 * reported_at window [sinceDate, untilDate). Called repeatedly per weekly
 * bucket by the outbreak evaluator — kept to a single simple COUNT query.
 */
export async function countByDiseaseAndPlaceInWindow(
  db: Db,
  diseaseCode: string,
  placeId: string,
  sinceDate: Date,
  untilDate: Date = new Date(),
): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM disease_cases
    WHERE disease_code = ${diseaseCode} AND place_id = ${placeId}
      AND reported_at >= ${sinceDate} AND reported_at < ${untilDate}
  `);
  return (r.rows[0] as { count: number }).count;
}

/** Distinct place_ids with at least one case of a disease since a date — lets the
 * outbreak evaluator skip places with no recent activity instead of scanning
 * all 261 districts every run. */
export async function listDistinctPlacesWithRecentCases(
  db: Db,
  diseaseCode: string,
  sinceDate: Date,
): Promise<string[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT place_id FROM disease_cases
    WHERE disease_code = ${diseaseCode} AND reported_at >= ${sinceDate}
  `);
  return (r.rows as { place_id: string }[]).map((row) => row.place_id);
}

// ── Disease-type registry ────────────────────────────────────────────────────
export interface DiseaseTypeRow {
  code: string;
  label: string;
  idsr_priority: boolean;
  baseline_window_days: number;
  alert_sigma: number;
  enabled: boolean;
}

export async function upsertDiseaseType(
  db: Db,
  t: {
    code: string; label: string; idsrPriority: boolean;
    baselineWindowDays: number; alertSigma: number; enabled: boolean;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO disease_types (code, label, idsr_priority, baseline_window_days, alert_sigma, enabled)
    VALUES (${t.code}, ${t.label}, ${t.idsrPriority}, ${t.baselineWindowDays}, ${t.alertSigma}, ${t.enabled})
    ON CONFLICT (code) DO UPDATE SET
      label = EXCLUDED.label, idsr_priority = EXCLUDED.idsr_priority,
      baseline_window_days = EXCLUDED.baseline_window_days, alert_sigma = EXCLUDED.alert_sigma,
      enabled = EXCLUDED.enabled
  `);
}

export async function listEnabledDiseaseTypes(db: Db): Promise<DiseaseTypeRow[]> {
  const r = await db.execute(sql`
    SELECT code, label, idsr_priority, baseline_window_days, alert_sigma, enabled
    FROM disease_types WHERE enabled = true ORDER BY code
  `);
  return r.rows as unknown as DiseaseTypeRow[];
}
