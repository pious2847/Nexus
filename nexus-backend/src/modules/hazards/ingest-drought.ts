/**
 * One-off / manual drought ingestion (Open-Meteo historical archive, no key,
 * region-level). Scheduled weekly via hazards.jobs.ts (drought is slow-onset).
 *   pnpm --filter nexus-backend ingest:drought
 */
import 'dotenv/config';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';
import { AuditService } from '../../core/audit/audit.service';
import { GeographyService } from '../../core/geography/geography.service';
import { ingestDrought } from './ingestion';

async function main(): Promise<void> {
  const { db, close } = createDb();
  const audit = new AuditService(db);
  const summary = await ingestDrought({ db, hazards: new HazardService(db, audit), geography: new GeographyService(db) });
  console.log(
    `[ingest:drought] evaluated=${summary.evaluated} created=${summary.created.length} updated=${summary.updated.length} skipped=${summary.skipped.length}`,
  );
  await close();
}

main().catch((err) => {
  console.error('[ingest:drought] failed:', err);
  process.exit(1);
});
