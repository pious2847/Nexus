# Ghana Geography Seed Data

Verified reference data for the `places` geography tree (see
[../../docs/specs/03-foundation-data-model.md](../../docs/specs/03-foundation-data-model.md)).
Assembled and validated 2026-07-02.

## Files
| File | What | Size |
|------|------|------|
| `regions.json` | 16 regions: name, ISO code, capital, 2021 population | 3 KB |
| `districts_region_map.json` | 260 districts mapped to their region (derived by spatial join) | 24 KB |
| `GHA-ADM1-regions-simplified.geojson` | 16 region boundary polygons (simplified) | 263 KB |
| `GHA-ADM2-districts-simplified.geojson` | 260 district boundary polygons (simplified) | 2.9 MB |

Full-resolution ADM2 geometry (~27 MB) is **not** committed; download at seed time from the
source URL below if higher precision is needed. Simplified geometry is sufficient for map
rendering and point-in-district lookups.

## Verification results (why we trust this)
- **Regions: 16** ✅ (matches official structure).
- **Districts: 260** from geoBoundaries (2019 vintage) — see the **261 gap** below.
- **Spatial join validated:** all 260 districts assigned to a region by polygon containment
  (0 fallbacks). Per-region counts match official figures exactly where known — e.g. Eastern
  33, Greater Accra 29, Central 22, Volta 18, Northern 16, Western 14, Western North 9,
  Bono East 11.
- **Population cross-check:** sum of the 16 region populations = **30,822,019**, within
  **0.03%** of the official GSS 2021 total (30,832,019). Difference is rounding in per-region
  figures.

## ⚠️ The 260 → 261 reconciliation (must fix before final seed)
Ghana currently has **261** MMDAs; geoBoundaries' 2019 data has **260**. The missing one is:

- **Guan District** — **Oti Region**, created December 2020 (carved from Biakoye and Krachi
  West/Jasikan areas). geoBoundaries shows Oti with **8** districts; the current count is **9**.

**To reach 261:** add a Guan District record. Options for its geometry: (a) source an updated
boundary from a newer dataset, or (b) approximate from its parent districts and refine later.
Its region (Oti) and existence are confirmed; only precise geometry is pending.

## ⏳ Remaining data task: district-level population
`regions.json` has region populations. **District-level 2021 population is not yet joined** —
source it from **GSS 2021 PHC Volume 3A (Population of Administrative Units)** and join by
district name (fuzzy match; expect a handful of manual fixes due to spelling/boundary changes).
This feeds impact-based forecasting (spec 01 §9).

## Notes for the seeder
- Region name in geoBoundaries has a `" Region"` suffix (e.g. `Western North Region`);
  `regions.json` stores the stripped `name` plus the original `fullName`.
- District properties in the source GeoJSON contain **only the name** (`shapeName`) — no
  parent region — which is why `districts_region_map.json` (our derived join) is the source of
  the district→region relationship.
- Match district geometry (from the ADM2 GeoJSON `shapeName`) to the region via
  `districts_region_map.json`, then insert into `places` with `level='district'`,
  `parent_id = <region place>`.
- Add a **seed test asserting 16 regions and 261 districts** (spec 04 DoD).

## Sources & licenses (attribution required)
- **Region boundaries (ADM1):** geoBoundaries gbOpen GHA ADM1 — derived from OpenStreetMap,
  **CC-BY-SA 2.0**. ⚠️ Share-alike: if we *redistribute* these polygons via the Data Hub,
  share-alike terms apply. For internal seeding, attribute geoBoundaries/OSM.
- **District boundaries (ADM2):** geoBoundaries gbOpen GHA ADM2 — sourced from USAID Ghana
  HPNO & Ghana Statistical Service (2019), **CC-BY 4.0**. Attribute geoBoundaries + GSS.
  - Download: `https://www.geoboundaries.org/api/current/gbOpen/GHA/ADM1/` and `.../ADM2/`
- **Population (2021):** Ghana Statistical Service, 2021 Population and Housing Census,
  Volume 3A. Public official statistics. https://census2021.statsghana.gov.gh/
- **Current MMDA list (261):** data.gov.gh — Metropolitan, Municipal and District Assemblies.
- **Google Maps** (keys available) is the recommended source later for **community/locality
  centroids and geocoding** — not for admin polygons (Google doesn't permit boundary export).

## How this was produced
1. Fetched geoBoundaries API metadata for GHA ADM1/ADM2; downloaded GeoJSON.
2. Verified feature counts (16 / 260).
3. Spatial join (Turf.js `centerOfMass` + `booleanPointInPolygon`) to assign each district
   to its region; validated per-region counts against official figures.
4. Merged region capitals + 2021 populations; wrote `regions.json`,
   `districts_region_map.json`, and simplified GeoJSONs.
