import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Applies pending SQL migrations from src/db/migrations (ADR-0003).
 * Replaces the old boot-time execution of schema.sql — schema changes are now
 * versioned migrations, applied explicitly via `pnpm db:migrate`.
 *
 * NEVER run against production. Use a Neon branch for dev/CI.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(pool);

  console.log('[migrate] applying pending migrations…');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('[migrate] up to date.');

  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
