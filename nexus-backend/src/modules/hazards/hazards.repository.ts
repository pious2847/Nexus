/**
 * Data access for the hazard core: hazard types, events, transitions, predictions.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface HazardType {
  code: string;
  label: string;
  category: string;
  default_thresholds: unknown;
  signal_sources: unknown;
  evaluator_key: string;
  lead_time_hours: number | null;
  enabled: boolean;
}

export interface HazardEvent {
  id: string;
  hazard_type: string;
  place_id: string | null;
  state: string;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  color: string | null;
  title: string;
  description: string | null;
  confidence: number | null;
  impact_summary: unknown;
  started_at: string | null;
  expires_at: string | null;
  closed_at: string | null;
  source: string;
  created_by: string | null;
  created_at: string;
}

const EVENT_COLS = sql`id, hazard_type, place_id, state, severity, urgency, certainty, color,
  title, description, confidence, impact_summary, started_at, expires_at, closed_at, source, created_by, created_at`;

// ── Hazard types ─────────────────────────────────────────────────────────────
export async function listHazardTypes(db: Db, includeDisabled = false): Promise<HazardType[]> {
  const filter = includeDisabled ? sql`` : sql` WHERE enabled = true`;
  const r = await db.execute(sql`
    SELECT code, label, category, default_thresholds, signal_sources, evaluator_key, lead_time_hours, enabled
    FROM hazard_types${filter} ORDER BY code
  `);
  return r.rows as unknown as HazardType[];
}

export async function upsertHazardType(
  db: Db,
  t: {
    code: string; label: string; category: string; thresholds: unknown; sources: unknown;
    evaluatorKey: string; leadTimeHours: number | null; enabled: boolean;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO hazard_types (code, label, category, default_thresholds, signal_sources, evaluator_key, lead_time_hours, enabled)
    VALUES (${t.code}, ${t.label}, ${t.category}, ${JSON.stringify(t.thresholds)}::jsonb,
            ${JSON.stringify(t.sources)}::jsonb, ${t.evaluatorKey}, ${t.leadTimeHours}, ${t.enabled})
    ON CONFLICT (code) DO UPDATE SET
      label = EXCLUDED.label, category = EXCLUDED.category, default_thresholds = EXCLUDED.default_thresholds,
      signal_sources = EXCLUDED.signal_sources, evaluator_key = EXCLUDED.evaluator_key,
      lead_time_hours = EXCLUDED.lead_time_hours, enabled = EXCLUDED.enabled, updated_at = now()
  `);
}

export interface HazardTypePatch {
  label?: string;
  category?: string;
  thresholds?: unknown;
  leadTimeHours?: number | null;
  enabled?: boolean;
}

/** Partial runtime update (Module L — previously only editable via the seed-hazard-types.ts CLI). */
export async function updateHazardType(db: Db, code: string, patch: HazardTypePatch): Promise<HazardType | null> {
  const sets = [];
  if (patch.label !== undefined) sets.push(sql`label = ${patch.label}`);
  if (patch.category !== undefined) sets.push(sql`category = ${patch.category}`);
  if (patch.thresholds !== undefined) sets.push(sql`default_thresholds = ${JSON.stringify(patch.thresholds)}::jsonb`);
  if (patch.leadTimeHours !== undefined) sets.push(sql`lead_time_hours = ${patch.leadTimeHours}`);
  if (patch.enabled !== undefined) sets.push(sql`enabled = ${patch.enabled}`);
  if (sets.length === 0) {
    const r = await db.execute(sql`SELECT code, label, category, default_thresholds, signal_sources, evaluator_key, lead_time_hours, enabled FROM hazard_types WHERE code = ${code}`);
    return (r.rows[0] as unknown as HazardType) ?? null;
  }
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE hazard_types SET ${sql.join(sets, sql`, `)} WHERE code = ${code}
    RETURNING code, label, category, default_thresholds, signal_sources, evaluator_key, lead_time_hours, enabled
  `);
  return (r.rows[0] as unknown as HazardType) ?? null;
}

// ── Events ───────────────────────────────────────────────────────────────────
export interface CreateEventInput {
  hazardType: string; placeId?: string | null; state: string;
  severity?: string | null; urgency?: string | null; certainty?: string | null; color?: string | null;
  title: string; description?: string | null; confidence?: number | null;
  startedAt?: Date | null; expiresAt?: Date | null; source: string; createdBy?: string | null;
}

export async function insertEvent(db: Db, e: CreateEventInput): Promise<HazardEvent> {
  const r = await db.execute(sql`
    INSERT INTO hazard_events (hazard_type, place_id, state, severity, urgency, certainty, color,
      title, description, confidence, started_at, expires_at, source, created_by)
    VALUES (${e.hazardType}, ${e.placeId ?? null}, ${e.state}, ${e.severity ?? null}, ${e.urgency ?? null},
      ${e.certainty ?? null}, ${e.color ?? null}, ${e.title}, ${e.description ?? null}, ${e.confidence ?? null},
      ${e.startedAt ?? null}, ${e.expiresAt ?? null}, ${e.source}, ${e.createdBy ?? null})
    RETURNING ${EVENT_COLS}
  `);
  return r.rows[0] as unknown as HazardEvent;
}

export async function getEvent(db: Db, id: string): Promise<HazardEvent | null> {
  const r = await db.execute(sql`SELECT ${EVENT_COLS} FROM hazard_events WHERE id = ${id}`);
  return (r.rows[0] as unknown as HazardEvent) ?? null;
}

export async function listEvents(
  db: Db,
  f: { hazardType?: string; placeId?: string; state?: string; severity?: string; limit?: number },
): Promise<HazardEvent[]> {
  const conds = [sql`TRUE`];
  if (f.hazardType) conds.push(sql`hazard_type = ${f.hazardType}`);
  if (f.placeId) conds.push(sql`place_id = ${f.placeId}`);
  if (f.state) conds.push(sql`state = ${f.state}`);
  if (f.severity) conds.push(sql`severity = ${f.severity}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${EVENT_COLS} FROM hazard_events WHERE ${where} ORDER BY created_at DESC LIMIT ${f.limit ?? 50}
  `);
  return r.rows as unknown as HazardEvent[];
}

export async function updateEventState(
  db: Db,
  id: string,
  toState: string,
  opts: { setStartedAt?: boolean; setClosedAt?: boolean },
): Promise<void> {
  const started = opts.setStartedAt ? sql`, started_at = COALESCE(started_at, now())` : sql``;
  const closed = opts.setClosedAt ? sql`, closed_at = now()` : sql``;
  await db.execute(sql`
    UPDATE hazard_events SET state = ${toState}, updated_at = now()${started}${closed} WHERE id = ${id}
  `);
}

/** Find an open (non-closed) auto-raised event for a place within a recent window (dedup). */
export async function findOpenAutoEvent(
  db: Db,
  hazardType: string,
  placeId: string,
  withinHours: number,
): Promise<HazardEvent | null> {
  const r = await db.execute(sql`
    SELECT ${EVENT_COLS} FROM hazard_events
    WHERE hazard_type = ${hazardType} AND place_id = ${placeId} AND source = 'auto'
      AND state <> 'closed' AND created_at > now() - make_interval(hours => ${withinHours})
    ORDER BY created_at DESC LIMIT 1
  `);
  return (r.rows[0] as unknown as HazardEvent) ?? null;
}

export async function updateEventImpact(db: Db, id: string, impact: unknown): Promise<void> {
  await db.execute(sql`
    UPDATE hazard_events SET impact_summary = ${JSON.stringify(impact)}::jsonb, updated_at = now() WHERE id = ${id}
  `);
}

export async function getEventPlacePath(db: Db, eventId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM hazard_events e JOIN places p ON e.place_id = p.id WHERE e.id = ${eventId}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

// ── Transitions ──────────────────────────────────────────────────────────────
export async function insertTransition(
  db: Db,
  t: { eventId: string; fromState: string | null; toState: string; actorId?: string | null; reason?: string | null; snapshot?: unknown },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO event_transitions (hazard_event_id, from_state, to_state, actor_id, reason, data_snapshot)
    VALUES (${t.eventId}, ${t.fromState}, ${t.toState}, ${t.actorId ?? null}, ${t.reason ?? null},
            ${JSON.stringify(t.snapshot ?? {})}::jsonb)
  `);
}

export async function listTransitions(db: Db, eventId: string) {
  const r = await db.execute(sql`
    SELECT from_state, to_state, actor_id, reason, created_at
    FROM event_transitions WHERE hazard_event_id = ${eventId} ORDER BY created_at
  `);
  return r.rows as unknown as { from_state: string | null; to_state: string; actor_id: string | null; reason: string | null; created_at: string }[];
}

// ── Predictions ──────────────────────────────────────────────────────────────
export async function insertPrediction(
  db: Db,
  p: {
    hazardType: string; placeId?: string | null; hazardEventId?: string | null;
    riskScore?: number | null; confidence?: number | null; factors?: unknown; sources?: unknown;
    evaluatorKey?: string | null; modelVersion?: string | null; validFrom?: Date | null; validTo?: Date | null;
  },
): Promise<{ id: string }> {
  const r = await db.execute(sql`
    INSERT INTO hazard_predictions (hazard_type, place_id, hazard_event_id, risk_score, confidence, factors, sources,
      evaluator_key, model_version, valid_from, valid_to)
    VALUES (${p.hazardType}, ${p.placeId ?? null}, ${p.hazardEventId ?? null}, ${p.riskScore ?? null},
      ${p.confidence ?? null}, ${JSON.stringify(p.factors ?? {})}::jsonb, ${JSON.stringify(p.sources ?? [])}::jsonb,
      ${p.evaluatorKey ?? null}, ${p.modelVersion ?? null}, ${p.validFrom ?? null}, ${p.validTo ?? null})
    RETURNING id
  `);
  return r.rows[0] as unknown as { id: string };
}
