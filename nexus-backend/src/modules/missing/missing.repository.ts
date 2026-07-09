/**
 * Data access for missing persons & family reunification (spec 02 N3).
 * Sensitive PII, same posture as vulnerable.repository.ts — every list is
 * scoped by geography subtree, the service layer owns the RBAC check.
 *
 * DDL: src/db/migrations/0019_missing_persons_rumor_anticipatory.sql
 * (table: missing_persons). Fuzzy matching against safety_checkins /
 * vulnerable_persons uses pg_trgm's `similarity()` (already enabled by that
 * migration) — a human confirms a match before it's recorded, this is only
 * candidate discovery.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface MissingPersonRow {
  id: string;
  place_id: string;
  full_name: string;
  age_estimate: string | null;
  sex: string | null;
  distinguishing_features: string | null;
  photo_url: string | null;
  last_seen_lng: number | null;
  last_seen_lat: number | null;
  last_seen_at: string | null;
  reporter_id: string | null;
  reporter_phone: string;
  relationship_to_missing: string | null;
  status: string;
  matched_checkin_id: string | null;
  matched_vulnerable_person_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, place_id, full_name, age_estimate, sex, distinguishing_features, photo_url,
  ST_X(last_seen_location) AS last_seen_lng, ST_Y(last_seen_location) AS last_seen_lat, last_seen_at,
  reporter_id, reporter_phone, relationship_to_missing, status, matched_checkin_id,
  matched_vulnerable_person_id, resolved_by, resolved_at, notes, created_at, updated_at`;

export interface InsertMissingPersonInput {
  placeId: string;
  fullName: string;
  ageEstimate?: string | null;
  sex?: string | null;
  distinguishingFeatures?: string | null;
  photoUrl?: string | null;
  lastSeenLng?: number | null;
  lastSeenLat?: number | null;
  lastSeenAt?: Date | string | null;
  reporterId?: string | null;
  reporterPhone: string;
  relationshipToMissing?: string | null;
  notes?: string | null;
}

export async function insertMissingPerson(db: Db, p: InsertMissingPersonInput): Promise<MissingPersonRow> {
  const geom =
    p.lastSeenLng != null && p.lastSeenLat != null
      ? sql`ST_SetSRID(ST_MakePoint(${p.lastSeenLng}, ${p.lastSeenLat}), 4326)`
      : sql`NULL`;
  const r = await db.execute(sql`
    INSERT INTO missing_persons (place_id, full_name, age_estimate, sex, distinguishing_features, photo_url,
      last_seen_location, last_seen_at, reporter_id, reporter_phone, relationship_to_missing, notes)
    VALUES (${p.placeId}, ${p.fullName}, ${p.ageEstimate ?? null}, ${p.sex ?? null}, ${p.distinguishingFeatures ?? null},
      ${p.photoUrl ?? null}, ${geom}, ${p.lastSeenAt ?? null}, ${p.reporterId ?? null}, ${p.reporterPhone},
      ${p.relationshipToMissing ?? null}, ${p.notes ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as MissingPersonRow;
}

export async function getMissingPerson(db: Db, id: string): Promise<MissingPersonRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM missing_persons WHERE id = ${id}`);
  return (r.rows[0] as unknown as MissingPersonRow) ?? null;
}

/** ltree path of the record's place, for RBAC scope checks (mirrors shelterPlacePath). */
export async function missingPersonPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM missing_persons m JOIN places p ON m.place_id = p.id WHERE m.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface ListMissingFilter {
  status?: string;
}

/** List missing-person records within a geography subtree (the scope place and everything under it). */
export async function listMissingByScope(
  db: Db,
  scopePlaceId: string,
  f: ListMissingFilter = {},
): Promise<MissingPersonRow[]> {
  const conds = [
    sql`place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))`,
  ];
  if (f.status) conds.push(sql`status = ${f.status}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${COLS} FROM missing_persons WHERE ${where} ORDER BY created_at DESC
  `);
  return r.rows as unknown as MissingPersonRow[];
}

export interface UpdateMissingPersonPatch {
  status?: string;
  matchedCheckinId?: string | null;
  matchedVulnerablePersonId?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | string | null;
  notes?: string | null;
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateMissingPerson(db: Db, id: string, patch: UpdateMissingPersonPatch): Promise<MissingPersonRow | null> {
  const sets = [];
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.matchedCheckinId !== undefined) sets.push(sql`matched_checkin_id = ${patch.matchedCheckinId}`);
  if (patch.matchedVulnerablePersonId !== undefined) sets.push(sql`matched_vulnerable_person_id = ${patch.matchedVulnerablePersonId}`);
  if (patch.resolvedBy !== undefined) sets.push(sql`resolved_by = ${patch.resolvedBy}`);
  if (patch.resolvedAt !== undefined) sets.push(sql`resolved_at = ${patch.resolvedAt}`);
  if (patch.notes !== undefined) sets.push(sql`notes = ${patch.notes}`);
  if (sets.length === 0) return getMissingPerson(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE missing_persons SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as MissingPersonRow) ?? null;
}

export interface CandidateCheckinRow {
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
  score: number;
}

/**
 * Fuzzy-match candidates from safety check-ins ("I'm Safe") within the same
 * geography subtree — someone reported missing may already have checked in
 * safe under a slightly different name spelling.
 */
export async function findCandidateCheckins(db: Db, scopePlaceId: string, fullName: string): Promise<CandidateCheckinRow[]> {
  const r = await db.execute(sql`
    SELECT id, hazard_event_id, place_id, status, subject_name, reporter_phone, reported_by, source, notes,
      created_at, similarity(subject_name, ${fullName}) AS score
    FROM safety_checkins
    WHERE place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))
      AND subject_name IS NOT NULL
      AND similarity(subject_name, ${fullName}) > 0.3
    ORDER BY score DESC
    LIMIT 10
  `);
  return r.rows as unknown as CandidateCheckinRow[];
}

export interface CandidateVulnerablePersonRow {
  id: string;
  place_id: string;
  full_name: string;
  category: string;
  mobility_level: string;
  status: string;
  created_at: string;
  score: number;
}

/**
 * Fuzzy-match candidates from the vulnerable-persons registry within the
 * same geography subtree.
 */
export async function findCandidateVulnerablePersons(
  db: Db,
  scopePlaceId: string,
  fullName: string,
): Promise<CandidateVulnerablePersonRow[]> {
  const r = await db.execute(sql`
    SELECT id, place_id, full_name, category, mobility_level, status, created_at,
      similarity(full_name, ${fullName}) AS score
    FROM vulnerable_persons
    WHERE place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))
      AND similarity(full_name, ${fullName}) > 0.3
    ORDER BY score DESC
    LIMIT 10
  `);
  return r.rows as unknown as CandidateVulnerablePersonRow[];
}
