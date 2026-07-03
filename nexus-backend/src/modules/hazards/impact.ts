/**
 * Impact-based forecasting (spec 01 §9). Given a hazard event's place, compute
 * who/what is in the affected area — population + exposed facilities — over the
 * geography subtree (ltree `<@`), so a region event counts all its districts.
 *
 * Data notes: population is present for regions; district-level population is a
 * pending data task, so it may be null for district events. Facility counts come
 * from geo-tagged sanitation assets (place_id) — real once backfill has run.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface ImpactSummary {
  population: number | null;
  districtsInScope: number;
  facilities: {
    schools: number;
    toilets: number;
    sanitationUnits: number;
    wasteFacilities: number;
    dumpSites: number;
  };
}

export async function computeImpact(db: Db, placeId: string): Promise<ImpactSummary | null> {
  const r = await db.execute(sql`
    WITH scope AS (
      SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${placeId})
    )
    SELECT
      (SELECT population FROM places WHERE id = ${placeId})::int                                  AS population,
      (SELECT count(*) FROM places WHERE level = 'district' AND id IN (SELECT id FROM scope))::int AS districts_in_scope,
      (SELECT count(*) FROM registered_toilets        WHERE place_id IN (SELECT id FROM scope))::int AS toilets,
      (SELECT count(*) FROM sanitation_units          WHERE place_id IN (SELECT id FROM scope))::int AS sanitation_units,
      (SELECT count(*) FROM waste_facilities          WHERE place_id IN (SELECT id FROM scope))::int AS waste_facilities,
      (SELECT count(*) FROM school_sanitation_metrics WHERE place_id IN (SELECT id FROM scope))::int AS schools,
      (SELECT count(*) FROM illegal_dump_sites        WHERE place_id IN (SELECT id FROM scope))::int AS dump_sites
  `);
  const row = r.rows[0] as
    | {
        population: number | null;
        districts_in_scope: number;
        toilets: number;
        sanitation_units: number;
        waste_facilities: number;
        schools: number;
        dump_sites: number;
      }
    | undefined;
  if (!row) return null;
  return {
    population: row.population ?? null,
    districtsInScope: row.districts_in_scope,
    facilities: {
      schools: row.schools,
      toilets: row.toilets,
      sanitationUnits: row.sanitation_units,
      wasteFacilities: row.waste_facilities,
      dumpSites: row.dump_sites,
    },
  };
}

/** Human-readable one-liner, e.g. "~2,310,939 people · 3 schools, 5 toilets across 16 districts". */
export function summarizeImpact(i: ImpactSummary): string {
  const parts: string[] = [];
  if (i.population != null) parts.push(`~${i.population.toLocaleString()} people`);
  const f = i.facilities;
  const fac = [
    f.schools && `${f.schools} schools`,
    f.toilets && `${f.toilets} toilets`,
    f.wasteFacilities && `${f.wasteFacilities} facilities`,
  ].filter(Boolean);
  if (fac.length) parts.push(fac.join(', '));
  if (i.districtsInScope) parts.push(`across ${i.districtsInScope} districts`);
  return parts.join(' · ') || 'no exposure data';
}
