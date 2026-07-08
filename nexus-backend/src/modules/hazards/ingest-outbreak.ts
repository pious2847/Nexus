/**
 * One-off / manual outbreak-detection ingestion (statistical spike detection
 * over reported disease_cases — no external API, unlike the other ingest-*
 * CLIs). Scheduled weekly via hazards.jobs.ts (epi case counts don't change
 * meaningfully within a day).
 *   pnpm --filter nexus-backend ingest:outbreak
 */
import 'dotenv/config';
import { createDb } from '../../shared/db';
import { HazardService } from './hazards.service';
import { AuditService } from '../../core/audit/audit.service';
import { GeographyService } from '../../core/geography/geography.service';
import { ingestOutbreak } from './ingestion';

async function main(): Promise<void> {
  const { db, close } = createDb();
  const audit = new AuditService(db);
  const summary = await ingestOutbreak({ db, hazards: new HazardService(db, audit), geography: new GeographyService(db) });
  console.log(
    `[ingest:outbreak] evaluated=${summary.evaluated} created=${summary.created.length} updated=${summary.updated.length} skipped=${summary.skipped.length}`,
  );
  await close();
}

main().catch((err) => {
  console.error('[ingest:outbreak] failed:', err);
  process.exit(1);
});
