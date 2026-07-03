/**
 * Reusable hazard ingestion functions, shared by the CLIs and the scheduler
 * (hazards.jobs.ts). Each runs an evaluator and returns its summary.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';
import type { GeographyService } from '../../core/geography/geography.service';
import type { HazardService } from './hazards.service';
import { fetchActiveFires } from '../../integrations/firms';
import { BushfireEvaluator, type IngestSummary } from './evaluators/bushfire';
import { RainfallEvaluator, type RainfallSummary, type RainfallTarget } from './evaluators/rainfall';

export interface IngestDeps {
  db: Db;
  hazards: HazardService;
  geography: GeographyService;
}

/** Fetch FIRMS active fires and raise/update bushfire events. */
export async function ingestFirms(deps: IngestDeps): Promise<IngestSummary> {
  const fires = await fetchActiveFires();
  return new BushfireEvaluator({ db: deps.db, hazards: deps.hazards, geography: deps.geography }).run(fires);
}

/** Region centroids used as rainfall evaluation targets. */
export async function getRainfallTargets(db: Db): Promise<RainfallTarget[]> {
  const rows = (
    await db.execute(sql`
      SELECT id, name, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng
      FROM places WHERE level = 'region' AND centroid IS NOT NULL
    `)
  ).rows as unknown as { id: string; name: string; lat: number; lng: number }[];
  return rows.map((r) => ({ placeId: r.id, name: r.name, lat: r.lat, lng: r.lng }));
}

/** Evaluate forecast rainfall per region and raise/update heavy_rainfall events. */
export async function ingestRainfall(deps: IngestDeps): Promise<RainfallSummary> {
  const targets = await getRainfallTargets(deps.db);
  return new RainfallEvaluator({ db: deps.db, hazards: deps.hazards }).run(targets);
}
