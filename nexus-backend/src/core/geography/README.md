# core/geography

The national geography backbone: a single self-referential **`places`** tree
(`country → region → district → constituency → community`) that every domain
record references via `place_id`. Replaces the old free-text `district` string
(ADR-0007). Backed by PostGIS (`boundary`, `centroid`) and ltree (`path`).

## Files
- `geography.schema.ts` — Drizzle table definition for `places` (PostGIS + ltree custom types).
- `geography.repository.ts` — all SQL: counts, subtree, point-in-district, nearest, scope check.
- `geography.service.ts` — the API other modules use (wraps the repository).
- `geography.util.ts` — `slugify` / `buildPath` for ltree paths.
- `seed-geography.ts` — loads `/data/geography` and seeds 1 country + 16 regions + 261 districts.
- DDL: `src/db/migrations/0001_places.sql`.

## Usage
```ts
import { createDb } from '../../shared/db';
import { GeographyService } from './geography.service';

const { db } = createDb();
const geo = new GeographyService(db);

await geo.countDistricts();                       // 261
await geo.districtForPoint({ lng: -0.1969, lat: 5.6037 }); // district containing Accra
await geo.nearest('region', { lng: -0.84, lat: 9.40 });    // nearest region to Tamale
await geo.isWithinScope('gh.northern.tolon', 'gh.northern'); // true (RBAC geo-scope)
```

## Setup / seed (dev)
```bash
# against a Neon BRANCH, never production
pnpm --filter nexus-backend db:migrate        # creates the places table (0001)
pnpm --filter nexus-backend seed:geography    # loads regions + districts
```

## Notes & follow-ups
- **Guan District (Oti)** is seeded without geometry (it post-dates the 2019 boundary
  source). Source its polygon later and backfill `boundary`/`centroid`.
- **District `category`** (metropolitan/municipal/district) and **district population** are
  not yet set — enrich from the data.gov.gh MMDA list + GSS Vol 3A.
- `path` uses slugified names; district→region relationships come from the validated
  spatial join in `/data/geography/districts_region_map.json`.
