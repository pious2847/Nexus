import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config (ADR-0003). Schema is co-located per module as
 * `*.schema.ts` files and picked up by the glob below. Migrations are versioned
 * in src/db/migrations and replace the old boot-time schema.sql (ADR-0003).
 *
 * NOTE: schema files are added starting in Phase 0 Step 0.2; until then this
 * config is inert. Never run migrations against production — use a Neon branch.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/**/*.schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
