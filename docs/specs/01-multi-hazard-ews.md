# Detailed Spec 01 — Multi-Hazard Early Warning System (Module B)

> **Status:** Detailed planning (not built). This is the deep spec for the platform's
> prediction & warning core. Parent: [MASTER_PLAN.md](../MASTER_PLAN.md) §4 Module B.
>
> **Last updated:** 2026-07-02

---

## 1. Purpose & scope

This module turns raw signals (weather, satellite, sensors, citizen reports, agency
feeds) into **hazard events**, **risk predictions**, and **impact-based warnings** for
all of Ghana. It is the beating heart of the platform — every other module either feeds
it (data in) or consumes it (alerts, maps, analytics out).

It is built on the WMO 4-pillar early-warning model:

1. **Risk knowledge** — what/where is vulnerable (§8 risk layer)
2. **Monitoring & forecasting** — detect & predict hazards (§6 pipeline, §7 sources)
3. **Warning & dissemination** — issue impact-based warnings (§9 events, §10 impact, §11 authority)
4. **Preparedness** — feed alerts (Module F) & response (Module M) so people can act

### 1.1 Locked decisions (from planning Q&A)
| Decision | Choice |
|----------|--------|
| Prediction approach at launch | **Hybrid** — external forecast products + tunable threshold rules + Gemini narrative; swap in our ML later |
| Warning authority | **Tiered by severity** — advisory can auto-publish; watch/warning/emergency need authorized approval |
| Severity scale | **CAP-aligned** — Severity × Urgency × Certainty + green→red colors |
| Impact forecasting | **Basic at launch** — population + key facilities (schools/clinics) in affected area |
| Launch hazards | **Floods, Heavy rainfall, Bushfire, Disease outbreak, Drought** (full set); framework extensible |
| Uncertainty display | **Split view** — officials see confidence %/model/sources; citizens see simplified color + likelihood |
| Risk zones | **Seed known flood/fire-prone zones + historical hotspots** on day one, refine with data |

---

## 2. The hazard framework (config-driven, extensible)

The golden rule: **adding a new hazard type must not require rewriting the engine.**
A hazard type is a configuration record + a pluggable "signal evaluator", not hard-coded logic.

```
hazard_type {
  code            // 'flood' | 'heavy_rainfall' | 'bushfire' | 'disease_outbreak' | 'drought' | ...
  label, icon, color_scale
  category        // CAP category: Met | Geo | Fire | Health | Env | Safety | Infra
  default_thresholds (JSON, per-region overridable)
  signal_sources  // which data sources feed it (§7)
  evaluator_key   // which strategy computes risk (rules/external/ml)
  lead_time_hours // typical warning horizon
  enabled         // toggle per deployment
}
```

New hazard = insert a `hazard_type` row + (optionally) register an evaluator strategy.
Everything downstream (events, alerts, maps, analytics) works automatically because they
key off `hazard_type.code`.

---

## 3. Launch hazards — signals, sources & thresholds

Each hazard defines **inputs → rule → event**. Thresholds are defaults, overridable per region.

### 3.1 Floods 🌊 (anchor hazard)
- **Signals:** rainfall (forecast + observed), river discharge/levels, soil saturation, terrain/low-lying zones, historical flood footprint, upstream dam spillage (Bagre/Akosombo context), citizen "water rising" reports.
- **Sources:** GloFAS (Global Flood Awareness System) river-flood forecasts, Open-Meteo/GMet rainfall, seeded flood-prone zones (§8), water-level IoT sensors, citizen reports.
- **Rule example (default):** `forecast_rainfall_24h > 50mm` AND `place ∈ flood_prone_zone` → **Watch**; add observed river-level breach or ≥3 corroborating citizen reports → escalate to **Warning**.

### 3.2 Heavy rainfall 🌧️ (coupled with floods)
- **Signals:** short-horizon precipitation forecast, intensity (mm/hr), duration.
- **Sources:** Open-Meteo now, GMet later.
- **Rule example:** `rainfall_24h > 30mm` → Advisory; `> 50mm` or `> 20mm/hr` → Watch. Feeds flood evaluator.

### 3.3 Bushfire 🔥 (dry-season)
- **Signals:** active-fire detections, dryness (days since rain), temperature, vegetation dryness, wind.
- **Sources:** NASA FIRMS (near-real-time active fire/thermal), Open-Meteo temp/wind/humidity, seeded fire-prone zones, citizen reports.
- **Rule example:** FIRMS active fire within district + `humidity < 30%` + `wind > X` → Warning; dry-season fire-danger index crosses threshold → Advisory (preventive).

### 3.4 Disease outbreak 🦠 (ties to floods & sanitation)
- **Signals:** case-count spikes vs baseline per district (cholera, meningitis, measles, malaria — IDSR priority diseases), proximity to recent flooding/contaminated water/sanitation failures.
- **Sources:** Health module case reports (Module D), sanitation health scores (Module E), flood events (this module).
- **Rule example:** case count `> mean + 2σ` over trailing weeks in a district → outbreak **Watch**; sustained rise or lab confirmation → **Warning**. Cross-link: flood event + sanitation failure in same district raises cholera watch proactively.

### 3.5 Drought / dry spell ☀️
- **Signals:** rainfall deficit over rolling window, consecutive dry days, temperature anomaly, (later) vegetation/NDVI & reservoir levels.
- **Sources:** Open-Meteo/GMet history, seeded drought-prone zones (Upper East/West, northern savanna).
- **Rule example:** `cumulative_rainfall_30d < 40% of seasonal normal` → Advisory; prolonged deficit → Watch. Slow-onset — longer lead times, weekly evaluation cadence.

> **Extensibility examples for later:** windstorm/rainstorm (roof damage), extreme heat, earthquake (Ghana has active fault zones near Accra), industrial/chemical, road-accident hotspots. Each is just a new `hazard_type` + evaluator.

---

## 4. Hazard event lifecycle (state machine)

A `hazard_event` is the central object — a specific hazard, at a specific place, over a
specific time window.

```
        (signals cross threshold / report corroborated)
                 │
   PREDICTED ──► WATCH ──► WARNING ──► ACTIVE ──► RESPONSE ──► RECOVERY ──► CLOSED
      │            │          │           │
      └── expires ─┴──────────┴───────────┘ (auto-close if signals recede, with audit)
```

| State | Meaning | Who moves it |
|-------|---------|--------------|
| `predicted` | Model/rules flag future risk (lead time) | System (auto) |
| `watch` | Conditions favorable; be prepared | System, confirmable by officer |
| `warning` | Hazard likely/imminent; act now | Authorized officer (tiered, §11) |
| `active` | Hazard is occurring | Officer / auto from confirmed reports |
| `response` | Response underway (links Module M) | Officer |
| `recovery` | Hazard passed; recovery/assessment | Officer |
| `closed` | Resolved & archived (becomes historical data) | Officer / auto |

Every transition is **audit-logged** with actor, timestamp, reason, and the data snapshot
that justified it. Closed events flow into the historical dataset that trains future models.

---

## 5. Severity & classification (CAP-aligned)

Each event/alert carries the CAP triplet plus a computed color:

- **Severity:** `Minor` → `Moderate` → `Severe` → `Extreme`
- **Urgency:** `Future` → `Expected` → `Immediate`
- **Certainty:** `Possible` → `Likely` → `Observed`
- **Color code:** derived (Green / Yellow / Orange / Red) for maps & citizen UI.

This maps 1:1 to Common Alerting Protocol fields so alerts (Module F) are interoperable
with NADMO/GMet/international systems and cell-broadcast later. Category uses CAP
categories (Met, Fire, Health, Geo, Env, Safety, Infra).

---

## 6. Prediction pipeline (hybrid → ML)

A pluggable pipeline so the *how* of prediction evolves without touching callers.

```
      ┌── External forecast products (GloFAS, GMet, FIRMS, Open-Meteo)
Inputs┤── Observed data (sensors, weather history)
      ├── Citizen reports (corroboration signal)
      └── Risk knowledge layer (seeded zones, vulnerability)
                     │
                     ▼
        ┌────────────────────────────┐
        │  PredictionEngine          │   pluggable strategies per hazard:
        │  (evaluator strategies)    │   - RuleEvaluator (thresholds)
        │                            │   - ExternalProductEvaluator (GloFAS/FIRMS)
        │                            │   - MLEvaluator (Phase 3, Python service)
        └────────────┬───────────────┘
                     ▼
        Risk score + confidence + contributing factors
                     │
                     ▼
   Gemini → plain-language, localized impact narrative ("why", "what to do")
                     │
                     ▼
        Create/Update hazard_event + prediction (with provenance)
```

- **Strategy interface:** `evaluate(place, hazardType, window) → { riskScore, confidence, factors[], sources[] }`. Rules & external products at launch; ML strategy drops in later behind the same interface.
- **Explainability:** every prediction stores its `factors` and `sources` so officials can see *why* (split-view §10) and so we can audit false alarms.
- **Provenance & versioning:** each prediction records which evaluator/version/model produced it — essential for later training and for trust.

---

## 7. Data source integrations (design for all four categories)

| Source | Feeds | Integration | Phase |
|--------|-------|-------------|-------|
| **Open-Meteo** | rainfall, temp, wind, humidity | existing service, extend nationwide | 1 |
| **GloFAS** (Copernicus) | river flood forecast | new adapter in `integrations/` | 1 |
| **NASA FIRMS** | active fire / thermal | new adapter | 1 |
| **GMet** (Ghana Met) | official forecasts/warnings | adapter, pending data agreement | 3–4 |
| **IoT sensors** (ESP32/water-level/waste) | observed levels | documented device ingestion API | 2–3 |
| **Citizen reports** | ground truth, corroboration | Module C | 1 |
| **Social/news listening** | early signals | build on existing AI news feed | 2–3 |
| **Partner/agency feeds** (NADMO/GHS/EPA/Fire) | official records | adapters per agreement | 4 |

Each integration is an isolated adapter in `nexus-backend/src/integrations/` implementing
a common `fetch → normalize → store` contract, so a failing/absent source degrades
gracefully and new sources are easy to add.

---

## 8. Risk knowledge layer (seeded + learned)

Per-place risk profiles that make warnings **impact-based** and useful on day one.

- **Seeded risk zones (launch):** pre-load known flood-prone areas (Accra flood plains,
  White/Black Volta basins, Northern lowlands), fire-prone savanna zones, drought-prone
  Upper East/West — sourced from NADMO records + expert input, stored as GeoJSON with a
  base risk rating per hazard.
- **Exposure data:** population per place (from census/boundary data) + registered
  facilities (schools, clinics, water points, toilets from existing registries).
- **Vulnerability:** composite index per place (poverty proxies, past event frequency,
  infrastructure quality) — generalizes today's vulnerability scoring nationwide.
- **Learned refinement:** as real events close, hotspot frequencies update risk ratings —
  the map gets smarter over time (feeds the flywheel).

Data model: `risk_profiles(place_id, hazard_type, base_risk, exposure_json,
vulnerability_index, source, updated_at)` + `risk_zones(hazard_type, geometry, rating)`.

---

## 9. Impact-based forecasting (basic at launch)

When an event is raised, compute *who/what is in the affected area*:

- **Affected area** = event geometry (district/polygon or buffered point).
- **Population exposed** = sum of population in intersected places.
- **Facilities at risk** = schools, clinics, water points, toilets, shelters intersecting the area.
- **Output:** "Flood **Warning** — Tolon District. Likely to affect **~3 schools, 1 clinic,
  ~4,200 people**. Certainty: Likely." — attached to the event & the citizen alert.

This is what turns a generic warning into something officials and citizens act on, and is
a major credibility signal for government/NGO buy-in. Full damage/economic/casualty
modeling is a later phase.

---

## 10. Uncertainty presentation (split view)

Same event, two renderings by audience (RBAC-driven):

- **Officials / agencies:** numeric confidence %, contributing factors, data sources,
  model/evaluator version, raw values vs thresholds, history of the event's transitions.
- **Citizens:** simplified — color band (Green/Yellow/Orange/Red) + plain likelihood
  ("**High chance** of flooding in your area in the next 12 hours") + what to do, in their
  language. No confusing numbers.

Implementation: one event object; the API returns an audience-appropriate projection based
on the requester's role.

---

## 11. Warning authority & approval (tiered by severity)

Prevents false alarms while keeping low-risk info flowing.

| Alert severity | Publishing rule |
|----------------|-----------------|
| **Advisory / Minor** | Auto-publish (system) with audit; officers can retract |
| **Watch / Moderate** | Auto-draft; district officer+ can publish |
| **Warning / Severe** | Requires authorized officer (regional+/agency) approval before mass send |
| **Emergency / Extreme** | Requires national agency (NADMO/GMet/GHS) approval |

- Auto-drafted warnings sit in an **approval queue** with the prediction's evidence attached.
- Approver, time, and decision are audit-logged.
- Approved warnings hand off to Module F (alerts/broadcasts) for CAP-formatted, geo-targeted,
  multi-channel delivery.

---

## 12. Data model (module tables)

```
hazard_types(code PK, label, category, color_scale, default_thresholds JSON,
             signal_sources JSON, evaluator_key, lead_time_hours, enabled)

hazard_events(id PK, hazard_type FK, place_id FK, geometry, state, severity,
              urgency, certainty, color, title, description, confidence,
              impact_summary JSON, started_at, expires_at, closed_at,
              created_by, source)  // 'auto' | user

predictions(id PK, hazard_event_id FK NULL, hazard_type FK, place_id FK,
            risk_score, confidence, factors JSON, sources JSON,
            evaluator_key, model_version, valid_from, valid_to, created_at)

event_transitions(id PK, hazard_event_id FK, from_state, to_state, actor_id,
                  reason, data_snapshot JSON, created_at)  // audit

risk_zones(id PK, hazard_type FK, geometry, rating, source, notes)

risk_profiles(place_id FK, hazard_type FK, base_risk, exposure JSON,
              vulnerability_index, source, updated_at, PK(place_id,hazard_type))

warning_approvals(id PK, hazard_event_id FK, required_role, status,
                  approver_id, decided_at, notes)
```

Indexes on `(hazard_type, place_id, state)` and geometry (PostGIS if available on Neon;
else geo-bounding-box + district keys). Every row is geo-tagged, timestamped, and source-attributed.

---

## 13. API surface (v1)

```
# Hazard types (config)
GET    /api/v1/hazard-types
POST   /api/v1/hazard-types            (admin) create/enable a hazard
PATCH  /api/v1/hazard-types/:code      (admin) tune thresholds

# Events
GET    /api/v1/hazards/events          filter: type, place, state, severity, bbox, time
GET    /api/v1/hazards/events/:id      (audience-projected: official vs citizen)
POST   /api/v1/hazards/events          (officer) manual event
PATCH  /api/v1/hazards/events/:id/state transition (guarded by RBAC + severity tier)

# Predictions
GET    /api/v1/hazards/predictions     current risk by place/type
GET    /api/v1/hazards/risk-map        risk layers for the map (Module H)

# Risk knowledge
GET    /api/v1/hazards/risk-zones
GET    /api/v1/hazards/risk-profiles/:placeId

# Approvals
GET    /api/v1/hazards/approvals       queue (authorized roles)
POST   /api/v1/hazards/approvals/:id/decide  approve/reject
```

All list endpoints paginated; all mutations validated (express-validator) and audit-logged.

## 14. Background jobs (in `jobs/`)

| Job | Cadence | Does |
|-----|---------|------|
| `pullForecasts` | hourly | fetch Open-Meteo/GloFAS/FIRMS, normalize, store |
| `evaluateHazards` | 15–60 min (fast hazards), daily/weekly (drought) | run evaluators per place, raise/update events & predictions |
| `corroborateReports` | on report ingest | link citizen reports to events, bump confidence |
| `autoExpire` | hourly | close events whose signals have receded (audited) |
| `draftWarnings` | on event escalation | create approval-queue drafts for severe/extreme |

Jobs are idempotent, logged, and monitored (Module L system-health).

## 15. Frontend surfaces

**Officials (dashboard):**
- **Hazards overview** — live event list + map, filter by type/region/severity/state.
- **Event detail** — timeline, evidence/factors, impact summary, sources, transition controls.
- **Approval queue** — pending warnings with evidence, approve/reject.
- **Risk map** — layered multi-hazard risk + seeded zones + historical hotspots.
- **Threshold config** (admin) — tune per-region thresholds without code.

**Citizens (PWA):**
- **My area** — current risk color + plain-language status for their subscribed places.
- **Active warnings** — what's happening, what to do, in their language.
- **Report** — one tap to report a hazard they see (feeds corroboration).

## 16. How this module connects to others
- **In:** Module C (reports/sensors), Module I (weather), Module D (disease cases), integrations (GloFAS/FIRMS/GMet).
- **Out:** Module F (alerts/broadcasts), Module H (maps), Module K (analytics), Module M (response), Module G (closed events → datasets).

## 17. Open questions for this module
> **Mostly resolved by [research/findings-01.md](../research/findings-01.md) (2026-07-02).**
1. ~~**PostGIS on Neon?**~~ ✅ **Resolved:** PostGIS fully supported (+ pgrouting, H3). Use real geospatial types.
2. ~~**GloFAS/FIRMS access**~~ ✅ **Resolved:** both free. FIRMS = MAP_KEY email signup (5k/10min, Node-friendly CSV). GloFAS = Copernicus registration; netCDF via Python, or WMS-T tiles on the map. Register accounts early.
3. ⚠️ **Population/boundary data** — use **geoBoundaries (HDX)** for the region/district tree, but **verify it's the current 16-region/261-district set** (many datasets are older 170/216). 2021 GSS population must be cross-referenced to polygons (one-time prep).
4. ⚠️ **Disease baselines** — **no open DHIMS2 API**; needs a **GHS/CHIM partnership**. Interim: bootstrap from our own Module D case reports; keep schema DHIS2-compatible.
5. ~~**Drought normals**~~ ✅ **Resolved:** **CHIRPS** (1981–present) + **CHPclim** monthly climatology via Digital Earth Africa / AWS. Ingest in Python.
6. 🆕 **GMet CAP feed** — GMet is rolling out CAP alerting (2026); pursue as an authoritative source/partnership.
