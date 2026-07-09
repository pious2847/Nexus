/**
 * Data access for N14 — Common Operating Picture + Incident Command. The COP
 * itself is a read-side aggregation over already-existing event-linked
 * tables (no new data collected there); `incident_command_roles` is the one
 * genuinely new table, for who's filling which ICS role on this event.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface IcsRoleRow {
  id: string;
  hazard_event_id: string;
  role_title: string;
  user_id: string;
  user_name: string;
  assigned_by: string | null;
  assigned_at: string;
  relieved_at: string | null;
}

const ROLE_COLS = sql`r.id, r.hazard_event_id, r.role_title, r.user_id, u.name AS user_name, r.assigned_by, r.assigned_at, r.relieved_at`;

export async function listActiveRoles(db: Db, hazardEventId: string): Promise<IcsRoleRow[]> {
  const r = await db.execute(sql`
    SELECT ${ROLE_COLS} FROM incident_command_roles r JOIN users u ON u.id = r.user_id
    WHERE r.hazard_event_id = ${hazardEventId} AND r.relieved_at IS NULL
    ORDER BY r.assigned_at
  `);
  return r.rows as unknown as IcsRoleRow[];
}

export async function getRole(db: Db, id: string): Promise<IcsRoleRow | null> {
  const r = await db.execute(sql`SELECT ${ROLE_COLS} FROM incident_command_roles r JOIN users u ON u.id = r.user_id WHERE r.id = ${id}`);
  return (r.rows[0] as unknown as IcsRoleRow) ?? null;
}

/** Relieves any current active holder of this role on this event, then assigns the new one. */
export async function assignRole(db: Db, hazardEventId: string, roleTitle: string, userId: string, assignedBy: string | null): Promise<IcsRoleRow> {
  await db.execute(sql`
    UPDATE incident_command_roles SET relieved_at = now()
    WHERE hazard_event_id = ${hazardEventId} AND role_title = ${roleTitle} AND relieved_at IS NULL
  `);
  const r = await db.execute(sql`
    INSERT INTO incident_command_roles (hazard_event_id, role_title, user_id, assigned_by)
    VALUES (${hazardEventId}, ${roleTitle}, ${userId}, ${assignedBy})
    RETURNING id
  `);
  const row = await getRole(db, (r.rows[0] as { id: string }).id);
  if (!row) throw new Error('Failed to load role assignment after insert');
  return row;
}

export async function relieveRole(db: Db, id: string): Promise<IcsRoleRow | null> {
  const before = await getRole(db, id);
  if (!before) return null;
  await db.execute(sql`UPDATE incident_command_roles SET relieved_at = now() WHERE id = ${id} AND relieved_at IS NULL`);
  return getRole(db, id);
}

export async function eventPlacePath(db: Db, hazardEventId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT p.path FROM hazard_events e JOIN places p ON p.id = e.place_id WHERE e.id = ${hazardEventId}
  `);
  return (r.rows[0] as { path: string } | undefined)?.path ?? null;
}

export interface CopEvent {
  id: string;
  hazard_type: string;
  place_id: string | null;
  title: string;
  state: string;
  severity: string | null;
  started_at: string | null;
  created_at: string;
}

export async function getEvent(db: Db, hazardEventId: string): Promise<CopEvent | null> {
  const r = await db.execute(sql`
    SELECT id, hazard_type, place_id, title, state, severity, started_at, created_at
    FROM hazard_events WHERE id = ${hazardEventId}
  `);
  return (r.rows[0] as unknown as CopEvent) ?? null;
}

export interface CopCounts {
  reports_linked: number;
  reports_in_area: number;
  dispatch_open: number;
  dispatch_in_progress: number;
  dispatch_done: number;
  checkins_safe: number;
  checkins_need_help: number;
  checkins_injured: number;
  sos_open: number;
  sos_acknowledged: number;
  shelters_open: number;
  shelters_full: number;
  shelter_occupancy: number;
  shelter_capacity: number;
  relief_distributions: number;
  rumors_open: number;
}

/** One aggregated snapshot pulling together every event-linked table, for the COP view. */
export async function getCopCounts(db: Db, hazardEventId: string, placePath: string | null): Promise<CopCounts> {
  const areaCond = placePath ? sql`p.path <@ (${placePath})::ltree` : sql`false`;

  const [reports, dispatch, checkins, sos, shelters, relief, rumors] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE rp.promoted_event_id = ${hazardEventId})::int AS linked,
        count(*) FILTER (WHERE rp.promoted_event_id IS DISTINCT FROM ${hazardEventId} AND ${areaCond})::int AS in_area
      FROM incident_reports rp JOIN places p ON p.id = rp.place_id
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'open')::int AS open,
        count(*) FILTER (WHERE status IN ('assigned','in_progress'))::int AS in_progress,
        count(*) FILTER (WHERE status = 'done')::int AS done
      FROM dispatch_tasks WHERE hazard_event_id = ${hazardEventId}
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'safe')::int AS safe,
        count(*) FILTER (WHERE status = 'need_help')::int AS need_help,
        count(*) FILTER (WHERE status = 'injured')::int AS injured
      FROM safety_checkins WHERE hazard_event_id = ${hazardEventId}
    `),
    placePath
      ? db.execute(sql`
          SELECT
            count(*) FILTER (WHERE s.status = 'open')::int AS open,
            count(*) FILTER (WHERE s.status = 'acknowledged')::int AS acknowledged
          FROM sos_alerts s JOIN places p ON p.id = s.place_id
          WHERE ${areaCond}
        `)
      : Promise.resolve({ rows: [{ open: 0, acknowledged: 0 }] }),
    placePath
      ? db.execute(sql`
          SELECT
            count(*) FILTER (WHERE sh.status = 'open')::int AS open,
            count(*) FILTER (WHERE sh.status = 'full')::int AS full,
            COALESCE(SUM(sh.current_occupancy), 0)::int AS occupancy,
            COALESCE(SUM(sh.capacity), 0)::int AS capacity
          FROM shelters sh JOIN places p ON p.id = sh.place_id
          WHERE ${areaCond}
        `)
      : Promise.resolve({ rows: [{ open: 0, full: 0, occupancy: 0, capacity: 0 }] }),
    db.execute(sql`SELECT count(*)::int AS count FROM relief_distributions WHERE hazard_event_id = ${hazardEventId}`),
    db.execute(sql`SELECT count(*)::int AS count FROM rumor_reports WHERE hazard_event_id = ${hazardEventId} AND status IN ('reported','reviewing')`),
  ]);

  const rp = reports.rows[0] as { linked: number; in_area: number };
  const dt = dispatch.rows[0] as { open: number; in_progress: number; done: number };
  const ck = checkins.rows[0] as { safe: number; need_help: number; injured: number };
  const so = sos.rows[0] as { open: number; acknowledged: number };
  const sh = shelters.rows[0] as { open: number; full: number; occupancy: number; capacity: number };
  const rl = relief.rows[0] as { count: number };
  const ru = rumors.rows[0] as { count: number };

  return {
    reports_linked: rp.linked,
    reports_in_area: rp.in_area,
    dispatch_open: dt.open,
    dispatch_in_progress: dt.in_progress,
    dispatch_done: dt.done,
    checkins_safe: ck.safe,
    checkins_need_help: ck.need_help,
    checkins_injured: ck.injured,
    sos_open: so.open,
    sos_acknowledged: so.acknowledged,
    shelters_open: sh.open,
    shelters_full: sh.full,
    shelter_occupancy: sh.occupancy,
    shelter_capacity: sh.capacity,
    relief_distributions: rl.count,
    rumors_open: ru.count,
  };
}
