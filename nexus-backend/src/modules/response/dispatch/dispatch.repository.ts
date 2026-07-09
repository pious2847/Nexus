/**
 * Data access for incident dispatch tasking (Module M). `dispatch_tasks` +
 * `dispatch_task_events` (the status-change log, the raw material for the
 * M5 after-action timeline the orchestrator builds separately).
 *
 * DDL: src/db/migrations/0018_emergency_response.sql.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';
import type { DispatchStatus } from './dispatch.state';

export interface DispatchTaskRow {
  id: string;
  hazard_event_id: string | null;
  place_id: string | null;
  task_type: string;
  description: string | null;
  priority: string;
  status: DispatchStatus;
  assigned_to: string | null;
  source_type: string | null;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const COLS = sql`id, hazard_event_id, place_id, task_type, description, priority, status,
  assigned_to, source_type, source_id, created_by, created_at, updated_at, completed_at`;

export interface InsertTaskInput {
  hazardEventId?: string | null;
  placeId?: string | null;
  lng?: number | null;
  lat?: number | null;
  taskType: string;
  description?: string | null;
  priority?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  createdBy?: string | null;
}

export async function insertTask(db: Db, t: InsertTaskInput): Promise<DispatchTaskRow> {
  const geom = t.lng != null && t.lat != null ? sql`ST_SetSRID(ST_MakePoint(${t.lng}, ${t.lat}), 4326)` : sql`NULL`;
  const r = await db.execute(sql`
    INSERT INTO dispatch_tasks (hazard_event_id, place_id, geometry, task_type, description, priority,
      source_type, source_id, created_by)
    VALUES (${t.hazardEventId ?? null}, ${t.placeId ?? null}, ${geom}, ${t.taskType}, ${t.description ?? null},
      ${t.priority ?? 'normal'}, ${t.sourceType ?? null}, ${t.sourceId ?? null}, ${t.createdBy ?? null})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as DispatchTaskRow;
}

export async function getTask(db: Db, id: string): Promise<DispatchTaskRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM dispatch_tasks WHERE id = ${id}`);
  return (r.rows[0] as unknown as DispatchTaskRow) ?? null;
}

/**
 * ltree path of the task's place, for RBAC scope checks. `place_id` is
 * nullable on this table (a task may be raised before/without a resolved
 * place), so this can return null — mirrors `alerts.repository.ts`'s
 * `placePathById`/`getEventPlacePath`-style handling of an optional place:
 * a null path means the caller falls back to requiring a national-scoped
 * grant (see `rbac.ts`'s `can()` — targetPath null is only satisfied by a
 * grant with `scopePath: null`).
 */
export async function getTaskPlacePath(db: Db, id: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path::text AS path FROM dispatch_tasks t JOIN places p ON t.place_id = p.id WHERE t.id = ${id}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export async function updateTaskStatus(
  db: Db,
  id: string,
  status: DispatchStatus,
  opts: { assignedTo?: string | null; setCompletedAt?: boolean } = {},
): Promise<DispatchTaskRow | null> {
  const assigned = opts.assignedTo !== undefined ? sql`, assigned_to = ${opts.assignedTo}` : sql``;
  const completed = opts.setCompletedAt ? sql`, completed_at = now()` : sql``;
  const r = await db.execute(sql`
    UPDATE dispatch_tasks SET status = ${status}, updated_at = now()${assigned}${completed}
    WHERE id = ${id}
    RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as DispatchTaskRow) ?? null;
}

/** Set assigned_to without changing status (used when a task is already past 'open'). */
export async function updateTaskAssignee(db: Db, id: string, assignedTo: string | null): Promise<DispatchTaskRow | null> {
  const r = await db.execute(sql`
    UPDATE dispatch_tasks SET assigned_to = ${assignedTo}, updated_at = now() WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as DispatchTaskRow) ?? null;
}

/** List tasks within a geography subtree (the scope place and everything under it). */
export async function listByScope(
  db: Db,
  scopePlaceId: string,
  f: { status?: string; taskType?: string; hazardEventId?: string } = {},
): Promise<DispatchTaskRow[]> {
  const conds = [sql`p.path <@ (SELECT path FROM places WHERE id = ${scopePlaceId})`];
  if (f.status) conds.push(sql`t.status = ${f.status}`);
  if (f.taskType) conds.push(sql`t.task_type = ${f.taskType}`);
  if (f.hazardEventId) conds.push(sql`t.hazard_event_id = ${f.hazardEventId}`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`
    SELECT ${sql.join(
      [
        sql`t.id`, sql`t.hazard_event_id`, sql`t.place_id`, sql`t.task_type`, sql`t.description`,
        sql`t.priority`, sql`t.status`, sql`t.assigned_to`, sql`t.source_type`, sql`t.source_id`,
        sql`t.created_by`, sql`t.created_at`, sql`t.updated_at`, sql`t.completed_at`,
      ],
      sql`, `,
    )}
    FROM dispatch_tasks t JOIN places p ON t.place_id = p.id
    WHERE ${where}
    ORDER BY t.created_at DESC
  `);
  return r.rows as unknown as DispatchTaskRow[];
}

// ── Task events (status-change log) ─────────────────────────────────────────
export interface DispatchTaskEventRow {
  id: string;
  task_id: string;
  from_status: DispatchStatus | null;
  to_status: DispatchStatus;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export async function insertTaskEvent(
  db: Db,
  e: { taskId: string; fromStatus: DispatchStatus | null; toStatus: DispatchStatus; actorId?: string | null; note?: string | null },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO dispatch_task_events (task_id, from_status, to_status, actor_id, note)
    VALUES (${e.taskId}, ${e.fromStatus}, ${e.toStatus}, ${e.actorId ?? null}, ${e.note ?? null})
  `);
}

export async function listTaskEvents(db: Db, taskId: string): Promise<DispatchTaskEventRow[]> {
  const r = await db.execute(sql`
    SELECT id, task_id, from_status, to_status, actor_id, note, created_at
    FROM dispatch_task_events WHERE task_id = ${taskId} ORDER BY created_at
  `);
  return r.rows as unknown as DispatchTaskEventRow[];
}
