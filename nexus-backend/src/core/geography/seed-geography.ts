/**
 * Seeds the `places` tree: 1 country + 16 regions + 261 districts, from the
 * verified dataset in /data/geography (see that folder's README for provenance).
 *
 * - Regions: boundary + 2021 population from geoBoundaries ADM1 + GSS.
 * - Districts: boundary from geoBoundaries ADM2 (260), mapped to region by the
 *   validated spatial join; plus Guan District (Oti) added manually to reach 261
 *   (it post-dates the 2019 boundary source — geometry pending).
 *
 * Idempotent: truncates `places` and reseeds. Run with a Neon BRANCH url:
 *   pnpm --filter nexus-backend seed:geography
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../../shared/db';
import { buildPath } from './geography.util';

const DATA_DIR = path.resolve(__dirname, '../../../../data/geography');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const stripRegion = (n: string) => n.replace(/\s+Region$/i, '').trim();

interface RegionMeta {
  name: string;
  fullName: string;
  iso: string | null;
  capital: string | null;
  population2021: number | null;
}
interface GeoFeature {
  properties: { shapeName: string; shapeISO?: string };
  geometry: unknown;
}

interface InsertArgs {
  parentId: string | null;
  level: 'country' | 'region' | 'district';
  code: string | null;
  name: string;
  category: string | null;
  population: number | null;
  path: string;
  geometry: unknown | null;
  metadata?: Record<string, unknown>;
}

async function insertPlace(db: Db, a: InsertArgs): Promise<string> {
  const geo = a.geometry ? JSON.stringify(a.geometry) : null;
  const boundary = geo ? sql`ST_Multi(ST_GeomFromGeoJSON(${geo}))::geography` : sql`NULL`;
  const centroid = geo ? sql`ST_PointOnSurface(ST_GeomFromGeoJSON(${geo}))::geography` : sql`NULL`;
  const r = await db.execute(sql`
    INSERT INTO places (parent_id, level, code, name, category, population, boundary, centroid, path, metadata)
    VALUES (${a.parentId}, ${a.level}, ${a.code}, ${a.name}, ${a.category}, ${a.population},
            ${boundary}, ${centroid}, ${a.path}::ltree, ${JSON.stringify(a.metadata ?? {})}::jsonb)
    RETURNING id
  `);
  return (r.rows[0] as { id: string }).id;
}

async function main(): Promise<void> {
  const { db, close } = createDb();

  const regionsMeta: RegionMeta[] = readJson('regions.json');
  const districtMap: { district: string; region: string }[] = readJson('districts_region_map.json');
  const adm1 = readJson('GHA-ADM1-regions-simplified.geojson') as { features: GeoFeature[] };
  const adm2 = readJson('GHA-ADM2-districts-simplified.geojson') as { features: GeoFeature[] };

  const metaByRegion = new Map(regionsMeta.map((r) => [r.name, r]));
  const regionOfDistrict = new Map(districtMap.map((d) => [d.district, d.region]));

  console.log('[seed] truncating places…');
  await db.execute(sql`TRUNCATE places CASCADE`);

  // 1) Country
  const countryId = await insertPlace(db, {
    parentId: null, level: 'country', code: 'GH', name: 'Ghana',
    category: null, population: 30832019, path: 'gh', geometry: null,
    metadata: { source: 'GSS 2021 PHC' },
  });

  // 2) Regions (16)
  const region = new Map<string, { id: string; path: string }>();
  for (const f of adm1.features) {
    const name = stripRegion(f.properties.shapeName);
    const meta = metaByRegion.get(name);
    const p = buildPath('gh', name);
    const id = await insertPlace(db, {
      parentId: countryId, level: 'region', code: f.properties.shapeISO ?? null, name,
      category: null, population: meta?.population2021 ?? null, path: p, geometry: f.geometry,
      metadata: { capital: meta?.capital ?? null, fullName: f.properties.shapeName },
    });
    region.set(name, { id, path: p });
  }
  console.log(`[seed] regions: ${region.size}`);

  // 3) Districts (260 from geoBoundaries)
  const unmatched: string[] = [];
  let districts = 0;
  for (const f of adm2.features) {
    const name = f.properties.shapeName;
    const regionName = regionOfDistrict.get(name);
    const parent = regionName ? region.get(regionName) : undefined;
    if (!parent) { unmatched.push(name); continue; }
    await insertPlace(db, {
      parentId: parent.id, level: 'district', code: null, name,
      category: null, population: null, path: buildPath(parent.path, name), geometry: f.geometry,
      metadata: { boundarySource: 'geoBoundaries ADM2 (2019)' },
    });
    districts++;
  }

  // 4) Guan District — 261st, Oti Region (geometry pending)
  const oti = region.get('Oti');
  if (!oti) throw new Error('Oti region not found — cannot add Guan District');
  await insertPlace(db, {
    parentId: oti.id, level: 'district', code: null, name: 'Guan',
    category: null, population: null, path: buildPath(oti.path, 'Guan'), geometry: null,
    metadata: { note: 'Created Dec 2020; boundary geometry pending (post-dates geoBoundaries 2019).' },
  });
  districts++;

  if (unmatched.length) {
    console.warn(`[seed] WARNING: ${unmatched.length} districts had no region match:`, unmatched);
  }
  console.log(`[seed] districts: ${districts}`);
  console.log('[seed] done.');
  await close();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
