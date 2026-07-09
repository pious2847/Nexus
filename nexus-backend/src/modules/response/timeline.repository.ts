/**
 * Data access for the response timeline / after-action record (Module M §5).
 * Aggregates the event logs that already exist (dispatch_task_events,
 * relief_distributions) into one chronological picture for a hazard event —
 * "every action logged; auto-generates an after-action record per event."
 * No new table: this is a read-side join, not a duplicated log.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface DispatchTimelineEntry {
  kind: 'dispatch';
  taskId: string;
  taskType: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ReliefTimelineEntry {
  kind: 'relief';
  distributionId: string;
  itemType: string;
  quantity: number;
  recipientDesc: string | null;
  distributedBy: string | null;
  createdAt: string;
}

export async function listDispatchEvents(db: Db, hazardEventId: string): Promise<DispatchTimelineEntry[]> {
  const r = await db.execute(sql`
    SELECT e.task_id, t.task_type, e.from_status, e.to_status, e.actor_id, e.note, e.created_at
    FROM dispatch_task_events e
    JOIN dispatch_tasks t ON e.task_id = t.id
    WHERE t.hazard_event_id = ${hazardEventId}
    ORDER BY e.created_at ASC
  `);
  return (r.rows as {
    task_id: string; task_type: string; from_status: string | null; to_status: string;
    actor_id: string | null; note: string | null; created_at: string;
  }[]).map((row) => ({
    kind: 'dispatch' as const,
    taskId: row.task_id,
    taskType: row.task_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export async function listReliefDistributions(db: Db, hazardEventId: string): Promise<ReliefTimelineEntry[]> {
  const r = await db.execute(sql`
    SELECT rd.id, rs.item_type, rd.quantity, rd.recipient_desc, rd.distributed_by, rd.created_at
    FROM relief_distributions rd
    JOIN relief_stocks rs ON rd.stock_id = rs.id
    WHERE rd.hazard_event_id = ${hazardEventId}
    ORDER BY rd.created_at ASC
  `);
  return (r.rows as {
    id: string; item_type: string; quantity: number; recipient_desc: string | null;
    distributed_by: string | null; created_at: string;
  }[]).map((row) => ({
    kind: 'relief' as const,
    distributionId: row.id,
    itemType: row.item_type,
    quantity: row.quantity,
    recipientDesc: row.recipient_desc,
    distributedBy: row.distributed_by,
    createdAt: row.created_at,
  }));
}
