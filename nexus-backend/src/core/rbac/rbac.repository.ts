/**
 * Loads a user's geography-scoped grants for RBAC decisions.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';
import type { Grant } from './rbac';
import type { Role } from '@nexus/shared';

export async function getUserGrants(db: Db, userId: string): Promise<Grant[]> {
  const r = await db.execute(sql`
    SELECT ur.role_code AS role, p.path::text AS scope_path
    FROM user_roles ur
    LEFT JOIN places p ON ur.place_id = p.id
    WHERE ur.user_id = ${userId}
  `);
  const rows = r.rows as unknown as { role: string; scope_path: string | null }[];
  return rows.map((row) => ({ role: row.role as Role, scopePath: row.scope_path }));
}
