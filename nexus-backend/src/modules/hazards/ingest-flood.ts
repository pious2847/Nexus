/**
 * One-off / manual flood ingestion (GloFAS river discharge via Open-Meteo, no
 * key, region-level). Scheduled via hazards.jobs.ts.
 *   pnpm --filter nexus-backend ingest:flood
 */
import 'dotenv/config';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';
import { AuditService } from '../../core/audit/audit.service';
import { GeographyService } from '../../core/geography/geography.service';
import { ingestFlood } from './ingestion';

async function main(): Promise<void> {
  const { db, close } = createDb();
  const audit = new AuditService(db);
  const summary = await ingestFlood({ db, hazards: new HazardService(db, audit), geography: new GeographyService(db) });
  console.log(
    `[ingest:flood] evaluated=${summary.evaluated} created=${summary.created.length} updated=${summary.updated.length} skipped=${summary.skipped.length}`,
  );
  await close();
}

main().catch((err) => {
  console.error('[ingest:flood] failed:', err);
  process.exit(1);
});
