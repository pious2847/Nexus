import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';
import type { AuditEntry } from './audit.service';

export async function insertAuditLog(db: Db, e: AuditEntry): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, place_id, metadata, ip)
    VALUES (
      ${e.actorId ?? null}, ${e.action}, ${e.resourceType ?? null}, ${e.resourceId ?? null},
      ${e.placeId ?? null}, ${JSON.stringify(e.metadata ?? {})}::jsonb, ${e.ip ?? null}
    )
  `);
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
}

export async function recentAuditLogs(
  db: Db,
  filter: { actorId?: string; action?: string; limit?: number },
): Promise<AuditRow[]> {
  const conditions = [sql`TRUE`];
  if (filter.actorId) conditions.push(sql`actor_id = ${filter.actorId}`);
  if (filter.action) conditions.push(sql`action = ${filter.action}`);
  const where = sql.join(conditions, sql` AND `);
  const limit = filter.limit ?? 100;
  const r = await db.execute(sql`
    SELECT id, actor_id, action, resource_type, resource_id, created_at
    FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}
  `);
  return r.rows as unknown as AuditRow[];
}
