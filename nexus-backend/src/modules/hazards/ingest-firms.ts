/**
 * One-off / manual FIRMS bushfire ingestion. Runs harmlessly without a
 * FIRMS_MAP_KEY (0 detections). Scheduled automatically via hazards.jobs.ts.
 *   pnpm --filter nexus-backend ingest:firms
 */
import 'dotenv/config';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';
import { AuditService } from '../../core/audit/audit.service';
import { GeographyService } from '../../core/geography/geography.service';
import { ingestFirms } from './ingestion';

async function main(): Promise<void> {
  const { db, close } = createDb();
  const audit = new AuditService(db);
  const summary = await ingestFirms({ db, hazards: new HazardService(db, audit), geography: new GeographyService(db) });
  console.log(
    `[ingest:firms] fires=${summary.fires} districts=${summary.districts} created=${summary.created.length} updated=${summary.updated.length}`,
  );
  await close();
}

main().catch((err) => {
  console.error('[ingest:firms] failed:', err);
  process.exit(1);
});
