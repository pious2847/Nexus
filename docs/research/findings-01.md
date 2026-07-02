# Research Findings 01 — Data sources, infra & tooling

> Answers the open questions from [spec 01 §17](../specs/01-multi-hazard-ews.md) and
> scouts tooling for upcoming modules (Data Hub, Alerts, PWA). Findings only — decisions
> flagged where relevant.
>
> **Date:** 2026-07-02

---

## TL;DR — the important takeaways
1. **PostGIS works on Neon** — use real geospatial types (no bbox fallback). Bonus: `pgrouting` (dispatch routing) + `H3` (hex heatmaps/aggregation) also available.
2. **All three key hazard data sources are free**: GloFAS (floods), NASA FIRMS (bushfire), CHIRPS (drought/rainfall normals). Weather already via Open-Meteo.
3. **🔑 GMet is rolling out its own CAP alerting system in 2026**, coordinating with NADMO/Police/Armed Forces/media. This validates our CAP choice *and* gives us a concrete national integration/partnership path — we can interoperate, not reinvent.
4. **🔑 HDX (our Data Hub model) is built on CKAN**, an open-source data-portal engine. Real decision ahead: build the Data Hub custom vs. deploy/integrate CKAN.
5. **Arkesel already covers a lot**: SMS + **USSD** + **Voice in Twi/Hausa/Ewe** + **OTP** + MoMo billing — validates OTP login, local-language voice broadcasts, and USSD fallback for low-end phones.
6. **PWA push is viable but iOS-limited** → SMS stays the reliable channel for critical warnings (confirms multi-channel design). Use **Serwist** for the PWA.
7. **Disease case data is the one gap** — DHIMS2 has no open API; needs a GHS/CHIM partnership. Bootstrap by collecting our own via Module D.

---

## 1. Database & geospatial — Neon + PostGIS ✅ (resolves spec01 §17.1)
- **PostGIS is fully supported on Neon.** Gives `GEOMETRY`/`GEOGRAPHY` types, spatial indexes, and the functions we need for risk-zone/impact intersections.
- Neon also supports **`pgrouting`** (network routing — directly useful for Module M dispatch/relief routing) and **`H3`** (hexagonal geospatial indexing — ideal for risk heatmaps, aggregation, and privacy-preserving location bucketing in the Data Hub).
- **Decision:** use PostGIS geospatial types from the start; adopt H3 for map aggregation/heatmaps and for anonymizing citizen locations in public datasets.
- Docs: https://neon.com/docs/extensions/postgis , https://neon.com/docs/extensions/postgis-related-extensions

## 2. Flood data — GloFAS (Copernicus EMS) ✅ (resolves §17.2 partly)
- **Free, registration required.** Global daily river-flood forecasts + monthly seasonal streamflow outlook.
- Access channels: direct download via **Copernicus Early Warning Data Store**, ECMWF MARS (operational), tailored FTP on request, and **WMS-T** (time-enabled map tiles).
- Format: **netCDF** (point time-series or 2D grid) — Python-friendly. Variables: river discharge, soil wetness, snow water equiv, runoff.
- **Implication:** two integration paths — (a) quick win: overlay GloFAS **WMS-T tiles** directly on our Leaflet map; (b) real pipeline: pull netCDF in the **Python ML/ingestion service** (Phase 3) since netCDF handling is painful in Node. Start with (a), graduate to (b).
- Docs: https://global-flood.emergency.copernicus.eu/react/general-information/data-access/

## 3. Bushfire data — NASA FIRMS ✅ (resolves §17.2 partly)
- **Free MAP_KEY** by email signup. Limit **5,000 transactions / 10 min** (plenty).
- Endpoints: **Country** (`GHA`) and **Area** (bounding box) — both return CSV. Global detections within **~3 hours** of satellite pass (MODIS + VIIRS).
- **Implication:** easiest source to integrate — a simple Node adapter polling the country endpoint on a cron; no Python needed. Good first external-source win.
- Docs: https://firms.modaps.eosdis.nasa.gov/api/

## 4. Ghana boundaries & population ⚠️ (resolves §17.3, with a caveat)
- **Boundaries:** best source is **geoBoundaries via HDX** — ADM0/ADM1/ADM2 GeoJSON, open license, simplified + full versions. UN **SALB** is the authoritative alternative. `data.gov.gh` also has district shapefiles.
  - https://data.humdata.org/dataset/geoboundaries-admin-boundaries-for-ghana
- **⚠️ District-count caveat:** several datasets list **170 or 216 districts** (older vintages). Ghana currently has **16 regions / 261 MMDAs** (post-2018/2019 reorganization). We must source the **current 16-region / 261-district** set and not an old one. Verify ADM1 has 16 and ADM2 has 261 before loading.
- **Population:** the 2021 PHC figures (Ghana Statistical Service) must be **cross-referenced to boundary polygons manually** — no single ready-made "boundary + 2021 population" GeoJSON found. This is a one-time data-prep task feeding impact-based forecasting.

## 5. Drought / rainfall normals — CHIRPS ✅ (resolves §17.5)
- **Free**, 1981–present, **0.05° grid**, daily/pentad/monthly. Strong for data-sparse Africa.
- **CHPclim** provides the **monthly precipitation climatology** = the "seasonal normals" we need to compute rainfall deficits for drought detection.
- Easiest access: **Digital Earth Africa** (cloud-optimized GeoTIFFs, Open Data Cube) + **AWS Registry of Open Data**.
- **Implication:** CHIRPS (historical + normals) lives naturally in the Python ingestion service; compute per-district rainfall deficit vs. CHPclim normal for the drought evaluator.
- Docs: https://docs.digitalearthafrica.org/en/latest/data_specs/CHIRPS_specs.html , https://registry.opendata.aws/deafrica-chirps/

## 6. Disease/health data ⚠️ (resolves §17.4 — needs partnership)
- **DHIMS2** is Ghana's national health data system (a **DHIS2** instance) run by GHS's **CHIM** unit. It is **not openly API-accessible** for case-level/outbreak data.
- `data.gov.gh` publishes a **health-facilities list** — usable now for our facility registry & impact calculations.
- **Implication / decision:** disease **baselines** for outbreak detection require a **GHS/CHIM data-sharing agreement** (DHIS2 has a good API *if* granted access). Until then, **bootstrap Module D by collecting our own case reports** and computing baselines from accumulated data. Design our schema to be DHIS2/DHIMS2-compatible so future interop is easy.
- https://data.gov.gh/dataset/health-facilities-ghana

## 7. National alerting context — GMet CAP rollout 🔑 (strategic)
- **Ghana Meteorological Agency (GMet) is introducing a CAP-based alerting system (2026)** that pushes weather warnings to mobile devices/digital platforms, shared with **NADMO, Police, Armed Forces, Civil Aviation, media**.
- **Why this matters a lot:**
  1. It **validates** our CAP-aligned severity/alert design (spec01 §5).
  2. It gives a **concrete partnership/integration target** — consume GMet's CAP feed as an authoritative source, and position NEXUS as the platform that aggregates CAP alerts + citizen data + response coordination on top.
  3. Approaching GMet early (they're actively building) could make NEXUS a natural complementary layer rather than a competitor.
- https://gna.org.gh/2026/05/ghana-meteo-urges-citizens-to-take-weather-advisories-seriously/

## 8. Messaging — Arkesel (already a dependency) ✅
- REST API + **Node.js SDK**, delivery webhooks, direct routes to **MTN / Telecel / AirtelTigo**, **99.9% SLA, ISO 27001**.
- Covers **SMS, USSD, Voice, OTP, Email** — one vendor for several of our channels.
- **Voice messages in English, Twi, Hausa, Ewe** → directly enables the original **local-language voice-note / low-literacy** outreach idea for citizen alerts.
- **OTP** → powers citizen **phone-number login** (Module A decision).
- **USSD** → fallback interface for feature phones (report + subscribe without internet).
- Billing via **MoMo** (MTN/Telecel/AirtelTigo) + card.
- **Implication:** Arkesel can back SMS + Voice + USSD + OTP channels of Module F/A. Sender-ID registration (business docs, few days) is a launch checklist item.
- Docs: https://developers.arkesel.com/

## 9. Citizen push — Web Push / PWA ⚠️
- **Android:** full support via service workers (native-like).
- **iOS 16.4+:** works **only** when the PWA is **installed to home screen**, permission must be requested **from a click handler**, delivery ~**70–85%** (vs 90–95% Android).
- **VAPID** keys required; Apple requires the VAPID subject to be a `mailto:` or `https` URL.
- **Implication:** web push is great for engaged/installed users but **not reliable enough alone for life-safety warnings** → **SMS/Voice (Arkesel) remain the guaranteed channel** for severe/extreme alerts. This confirms the multi-channel design; push is a bonus tier, not the backbone.

## 10. PWA framework — Serwist ✅
- **Serwist** is the maintained **successor to `next-pwa`**, recommended in Next.js docs; handles offline caching, **Background Sync**, and multi-level caching. Pair with **IndexedDB** for the offline report/assessment queue.
- **⚠️ Build caveat:** Next.js 16 defaults to **Turbopack**, but **Serwist currently needs Webpack** → build script must pass `--webpack`. Note this for the frontend restructure.
- Docs: https://nextjs.org/docs/app/guides/progressive-web-apps

## 11. Data Hub engine — CKAN 🔑 (strategic decision ahead)
- **HDX is built on CKAN** — the open-source data-management system that also powers `data.gov`, `open.canada.ca`, and many national portals.
- Out of the box CKAN gives: dataset **catalog**, full **data + catalog API**, **DataStore**, **geospatial preview/search**, **federation** between portals, licensing, and access controls — i.e. most of our Module G.
- **The real decision (not now, but soon):**
  - **Option A — Build Module G custom** inside our Node monorepo. Full control, consistent UX, but we re-implement catalog/API/versioning/QA.
  - **Option B — Deploy CKAN** as the data portal and integrate it (SSO + link from our app). Massive head start, instant interoperability & credibility with the open-data world (same stack as HDX/data.gov.gh), but it's a separate **Python** system to run and theme.
  - **Option C — Hybrid:** collect/curate in our app; **publish** approved open datasets *to* CKAN (or to `data.gov.gh`) via its API for public distribution.
- **Leaning:** Option C looks strongest — we keep the collection/curation/QA experience native, and use CKAN (or Ghana's own CKAN-based `data.gov.gh`) as the public distribution layer. Decide when we spec Module G.
- Docs: https://ckan.org/features , https://github.com/ckan/ckan

---

## Impact on the plan (what changes)
- **Python service arrives earlier than Phase 3** in a *light* form: GloFAS (netCDF) + CHIRPS (GeoTIFF) ingestion are far easier in Python. Consider a minimal `nexus-ml` ingestion worker in Phase 1–2, before full ML.
- **Quick external-source wins order:** FIRMS (trivial, Node) → Open-Meteo (have it) → GloFAS WMS-T tiles (map overlay) → GloFAS/CHIRPS netCDF via Python.
- **Partnerships to open early:** GMet (CAP feed) and GHS/CHIM (disease baselines) — both are gating for full capability and both are receptive contexts.
- **One-time data-prep task:** load current 16-region/261-district geoBoundaries + attach 2021 GSS population. Prerequisite for impact-based warnings.
- **Confirm for Module G:** CKAN adopt-vs-build (lean hybrid).

## New open items surfaced
1. GMet partnership — who/how to approach for CAP feed access.
2. GHS/CHIM data-sharing agreement for DHIMS2/DHIS2 access.
3. Verify geoBoundaries vintage = current 261 districts before load.
4. Copernicus (GloFAS) + FIRMS account registration (free) — do early to get keys.
5. Data Hub: confirm hybrid-with-CKAN direction when speccing Module G.
