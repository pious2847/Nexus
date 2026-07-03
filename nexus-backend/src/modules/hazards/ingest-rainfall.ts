/**
 * One-off / manual heavy-rainfall ingestion (Open-Meteo, region-level, no key).
 * Scheduled automatically via hazards.jobs.ts.
 *   pnpm --filter nexus-backend ingest:rainfall
 */
import 'dotenv/config';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';
import { AuditService } from '../../core/audit/audit.service';
import { GeographyService } from '../../core/geography/geography.service';
import { ingestRainfall } from './ingestion';

async function main(): Promise<void> {
  const { db, close } = createDb();
  const audit = new AuditService(db);
  const summary = await ingestRainfall({ db, hazards: new HazardService(db, audit), geography: new GeographyService(db) });
  console.log(
    `[ingest:rainfall] evaluated=${summary.evaluated} created=${summary.created.length} updated=${summary.updated.length}`,
  );
  await close();
}

main().catch((err) => {
  console.error('[ingest:rainfall] failed:', err);
  process.exit(1);
});
