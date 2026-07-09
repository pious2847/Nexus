/**
 * Data access for anticipatory action / forecast-based triggers (N12).
 * `anticipatory_protocols` (the configured "if hazard X reaches state Y in
 * place Z, do actions [...]" rules) + `protocol_activations` (the fire-once
 * audit log, guarded by a unique (protocol_id, hazard_event_id) index).
 *
 * Mirrors dispatch.repository.ts / shelter.repository.ts's style (Drizzle
 * `sql` tag, ltree subtree scope checks via listByScope).
 *
 * DDL: src/db/migrations/0019_missing_persons_rumor_anticipatory.sql.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface ProtocolAction {
  type: 'notify_focal_points' | 'flag_vulnerable_evacuation' | 'pre_position_relief';
  params: Record<string, unknown>;
}

export interface ProtocolRow {
  id: string;
  name: string;
  hazard_type: string;
  place_id: string;
  trigger_state: string;
  actions: ProtocolAction[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, name, hazard_type, place_id, trigger_state, actions, active, created_by, created_at, updated_at`;

export interface InsertProtocolInput {
  name: string;
  hazardType: string;
  placeId: string;
  triggerState: string;
  actions: ProtocolAction[];
  active?: boolean;
  createdBy?: string | null;
}

export async function insertProtocol(db: Db, p: InsertProtocolInput): Promise<ProtocolRow> {
  const r = await db.execute(sql`
    INSERT INTO anticipatory_protocols (name, hazard_type, place_id, trigger_state, actions, active, created_by)
    VALUES (
      ${p.name}, ${p.hazardType}, ${p.placeId}, ${p.triggerState}, ${JSON.stringify(p.actions)}::jsonb,
      ${p.active ?? true}, ${p.createdBy ?? null}
    )
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as ProtocolRow;
}

export async function getProtocol(db: Db, id: string): Promise<ProtocolRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM anticipatory_protocols WHERE id = ${id}`);
  return (r.rows[0] as unknown as ProtocolRow) ?? null;
}

/** ltree path of the protocol's configured place, for RBAC scope checks. */
export async function protocolPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM anticipatory_protocols pr JOIN places p ON pr.place_id = p.id WHERE pr.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface ListProtocolFilter {
  hazardType?: string;
  active?: boolean;
}

/** List protocols configured within a geography subtree (the scope place and everything under it). */
export async function listProtocolsByScope(db: Db, scopePlaceId: string, f: ListProtocolFilter = {}): Promise<ProtocolRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.hazardType) conds.push(sql`pr.hazard_type = ${f.hazardType}`);
  if (f.active !== undefined) conds.push(sql`pr.active = ${f.active}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`pr.id`, sql`pr.name`, sql`pr.hazard_type`, sql`pr.place_id`, sql`pr.trigger_state`,
        sql`pr.actions`, sql`pr.active`, sql`pr.created_by`, sql`pr.created_at`, sql`pr.updated_at`,
      ],
      sql`, `,
    )}
    FROM anticipatory_protocols pr JOIN places p ON pr.place_id = p.id
    WHERE ${where}
    ORDER BY pr.created_at DESC
  `);
  return r.rows as unknown as ProtocolRow[];
}

export interface UpdateProtocolPatch {
  name?: string;
  triggerState?: string;
  actions?: ProtocolAction[];
  active?: boolean;
}

/** Partial update — only the fields present on `patch` are written. */
export async function updateProtocol(db: Db, id: string, patch: UpdateProtocolPatch): Promise<ProtocolRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.triggerState !== undefined) sets.push(sql`trigger_state = ${patch.triggerState}`);
  if (patch.actions !== undefined) sets.push(sql`actions = ${JSON.stringify(patch.actions)}::jsonb`);
  if (patch.active !== undefined) sets.push(sql`active = ${patch.active}`);
  if (sets.length === 0) return getProtocol(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`
    UPDATE anticipatory_protocols SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as ProtocolRow) ?? null;
}

/**
 * Active protocols matching a hazard event's (hazard_type, state) whose
 * configured place is the event's place OR an ancestor of it — a protocol
 * scoped to a region should fire for a hazard event in any district inside
 * that region, not just an exact place-id match.
 */
export async function findMatchingActiveProtocols(
  db: Db,
  hazardType: string,
  eventPlaceId: string,
  triggerState: string,
): Promise<ProtocolRow[]> {
  const r = await db.execute(sql`
    SELECT ${COLS}
    FROM anticipatory_protocols p
    WHERE p.active
      AND p.hazard_type = ${hazardType}
      AND p.trigger_state = ${triggerState}
      AND EXISTS (
        SELECT 1 FROM places ev, places pp
        WHERE ev.id = ${eventPlaceId} AND pp.id = p.place_id AND ev.path <@ pp.path
      )
  `);
  return r.rows as unknown as ProtocolRow[];
}

/** Pre-check against the unique (protocol_id, hazard_event_id) constraint. */
export async function hasActivated(db: Db, protocolId: string, hazardEventId: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM protocol_activations WHERE protocol_id = ${protocolId} AND hazard_event_id = ${hazardEventId}
  `);
  return r.rows.length > 0;
}

export interface ActivationRow {
  id: string;
  protocol_id: string;
  hazard_event_id: string;
  actions_taken: unknown[];
  triggered_at: string;
}

/**
 * Insert an activation row. If the unique (protocol_id, hazard_event_id)
 * constraint is violated (Postgres code 23505 — e.g. a concurrent call beat
 * this one to it), that's treated as "already activated" and this returns
 * null rather than throwing — the unique index is the real safety net, this
 * function is just the insert side of it.
 */
export async function insertActivation(
  db: Db,
  protocolId: string,
  hazardEventId: string,
  actionsTaken: unknown[],
): Promise<ActivationRow | null> {
  try {
    const r = await db.execute(sql`
      INSERT INTO protocol_activations (protocol_id, hazard_event_id, actions_taken)
      VALUES (${protocolId}, ${hazardEventId}, ${JSON.stringify(actionsTaken)}::jsonb)
      RETURNING id, protocol_id, hazard_event_id, actions_taken, triggered_at
    `);
    return (r.rows[0] as unknown as ActivationRow) ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

/** List activations within a geography subtree, joined through the hazard event's place, most recent first. */
export async function listActivationsByScope(db: Db, scopePlaceId: string): Promise<ActivationRow[]> {
  const r = await db.execute(sql`
    SELECT a.id, a.protocol_id, a.hazard_event_id, a.actions_taken, a.triggered_at
    FROM protocol_activations a
    JOIN hazard_events e ON a.hazard_event_id = e.id
    JOIN places p ON e.place_id = p.id
    WHERE p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})
    ORDER BY a.triggered_at DESC
  `);
  return r.rows as unknown as ActivationRow[];
}
