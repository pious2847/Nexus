/**
 * Backfills `place_id` on sanitation domain tables from the legacy `district`
 * string, using the geography resolver (Step 0.7). The district string is left
 * intact (dual-read) until the mapping is verified.
 *
 * Idempotent: only touches rows where place_id IS NULL. Reports matched/unmatched
 * per table so mismatches can be reviewed. Run against a Neon BRANCH:
 *   pnpm --filter nexus-backend backfill:place-id
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../../shared/db';
import { listDistrictsForResolver } from '../../core/geography/geography.repository';
import { DistrictResolver } from '../../core/geography/geography.resolver';

const TABLES = [
  'sanitation_units',
  'registered_toilets',
  'waste_facilities',
  'illegal_dump_sites',
  'gatherers',
  'community_health_scores',
  'school_sanitation_metrics',
  'sludge_jobs',
  'flood_assessments',
] as const;

async function backfillTable(db: Db, table: string, resolver: DistrictResolver) {
  // table is from a fixed allow-list above (not user input) — safe to inline.
  const rows = (
    await db.execute(
      sql`SELECT id, district FROM ${sql.raw(table)} WHERE place_id IS NULL AND district IS NOT NULL`,
    )
  ).rows as unknown as { id: string; district: string }[];

  let matched = 0;
  const unmatched = new Map<string, number>();
  for (const row of rows) {
    const hit = resolver.resolve(row.district);
    if (hit) {
      await db.execute(sql`UPDATE ${sql.raw(table)} SET place_id = ${hit.placeId} WHERE id = ${row.id}`);
      matched++;
    } else {
      unmatched.set(row.district, (unmatched.get(row.district) ?? 0) + 1);
    }
  }
  return { table, total: rows.length, matched, unmatched };
}

async function main(): Promise<void> {
  const { db, close } = createDb();
  const districts = await listDistrictsForResolver(db);
  const resolver = new DistrictResolver(districts);
  console.log(`[backfill] resolver built from ${districts.length} districts`);

  let totalMatched = 0;
  const allUnmatched = new Set<string>();
  for (const table of TABLES) {
    const r = await backfillTable(db, table, resolver);
    totalMatched += r.matched;
    const unmatchedStr =
      r.unmatched.size > 0 ? `  unmatched=${JSON.stringify(Object.fromEntries(r.unmatched))}` : '';
    for (const k of r.unmatched.keys()) allUnmatched.add(k);
    console.log(`  ${table.padEnd(26)} matched ${r.matched}/${r.total}${unmatchedStr}`);
  }

  console.log(`[backfill] done. total matched=${totalMatched}`);
  if (allUnmatched.size > 0) {
    console.log(`[backfill] district strings needing review: ${JSON.stringify([...allUnmatched])}`);
  }
  await close();
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
