/**
 * System health / job-monitoring (Module L). Previously the only "health"
 * visibility was a sanitation-scoped legacy cron-status endpoint
 * (dashboardController.js's getCronStatusHandler) — this is the
 * platform-wide equivalent: DB connectivity + latency, applied-migration
 * count, and which scheduled hazard jobs are enabled.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface SystemHealth {
  db: { connected: boolean; latencyMs: number | null; error?: string };
  migrations: { applied: number; latestAppliedAt: string | null };
  hazardJobs: { enabled: boolean };
  uptimeSeconds: number;
  timestamp: string;
}

export class SystemHealthService {
  constructor(private readonly db: Db) {}

  async getHealth(): Promise<SystemHealth> {
    const db = await this.checkDb();
    const migrations = await this.checkMigrations();
    return {
      db,
      migrations,
      hazardJobs: { enabled: process.env.ENABLE_HAZARD_JOBS === 'true' },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<SystemHealth['db']> {
    const start = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      return { connected: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { connected: false, latencyMs: null, error: (err as Error).message };
    }
  }

  private async checkMigrations(): Promise<SystemHealth['migrations']> {
    try {
      const r = await this.db.execute(
        sql`SELECT count(*)::int AS applied, max(created_at)::bigint AS latest FROM drizzle.__drizzle_migrations`,
      );
      const row = r.rows[0] as { applied: number; latest: string | null };
      return {
        applied: row.applied,
        latestAppliedAt: row.latest ? new Date(Number(row.latest)).toISOString() : null,
      };
    } catch {
      // The drizzle schema/table might not exist in some environments (e.g. a fresh
      // DB before the first migrate run) — report gracefully rather than 500ing.
      return { applied: 0, latestAppliedAt: null };
    }
  }
}
