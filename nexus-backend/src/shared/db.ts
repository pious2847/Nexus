import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

export type Db = NodePgDatabase<Record<string, never>>;

/**
 * Creates a Drizzle client + underlying pg Pool from DATABASE_URL. Used by
 * scripts (seed/migrate) and, later, the request path. Callers own the Pool and
 * must `close()` when done (scripts) — long-lived servers keep it open.
 *
 * NEVER point this at production for migrations/seeds — use a Neon branch.
 */
export function createDb(): { db: Db; pool: Pool; close: () => Promise<void> } {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
