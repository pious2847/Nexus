# N.E.X.U.S. — Master Plan (v2.0: National Scale)

> **Status:** Planning phase. Nothing in this document is built yet. This is the
> agreed blueprint we will implement in phases.
>
> **Last updated:** 2026-07-02
>
> **Detailed module specs & foundation docs** (deep dives from detailed-planning rounds):
> - [specs/01-multi-hazard-ews.md](specs/01-multi-hazard-ews.md) — Module B, the prediction/warning core ✅ specced
> - [specs/02-life-critical-features.md](specs/02-life-critical-features.md) — Module N, life-safety & resilience ✅ **adopted**
> - [specs/03-foundation-data-model.md](specs/03-foundation-data-model.md) — core schema (geography, identity, RBAC, auth, audit) ✅
> - [specs/04-migration-plan.md](specs/04-migration-plan.md) — Phase 0 steps + Definition of Done ✅
> - [adr/README.md](adr/README.md) — Architecture Decision Records (ADR-0001…0009) ✅
> - [research/findings-01.md](research/findings-01.md) — data sources, infra & tooling research ✅
> - _(more module specs to come as we build each)_
>
> **Decisions log** (from planning Q&A):
> - Name: keep NEXUS, re-expand acronym · Clients: Web + PWA (offline-first) · Data sharing: HDX-style (public + by-request + private) · Codebase: modular monorepo
> - Response: full **Emergency Response & Coordination** module (shelters, dispatch, volunteers) → see new **Module M**
> - Citizen trust: verification + reputation + corroboration threshold + community moderators; **light gamification only** (badges/recognition, no cash/airtime rewards)
> - Data sources: design for **all four** — satellite/external APIs, IoT sensors, social/news listening, partner/agency feeds
> - EWS: hybrid predictions · tiered warning authority · CAP-aligned severity · basic impact-based · full hazard set · split-view uncertainty · seeded risk zones (details in spec 01)
> - **Life-safety: Module N adopted** — resilience (N8) + guaranteed/acknowledged delivery (N9) are treated as **foundation**, not features. See spec 02.
> - **Engineering stack (ADRs):** TypeScript end-to-end · pnpm workspaces · Drizzle ORM + PostGIS/H3/pgrouting on Neon · Zod validation · Vitest+Supertest · node-cron→BullMQ/Redis for delivery · Serwist PWA · normalized `places` geography replacing the `district` string.
> - **First milestone = Phase 0** (restructure + geography + RBAC + auth, existing features preserved). Definition of Done in spec 04.

---

## 0. How to read this document

This plan is the single source of truth for the re-scoped N.E.X.U.S. platform. It
is deliberately exhaustive — every module, feature, and sub-feature is listed so
that (a) we know what "done" means, and (b) any developer who joins later can
understand the whole system from one file.

Sections:

1. Vision & the pivot (what changed and why)
2. Rebrand — keeping "NEXUS", re-expanding the acronym
3. Who uses it — personas & roles
4. **The full feature catalog** (the heart of this doc — all modules & sub-features)
5. User roles & permissions matrix
6. AI & ML strategy (today's AI + the future "national model")
7. System architecture & the modular monorepo structure
8. Data model — geography, hazards, datasets, alerts
9. Alerting & broadcast design (CAP standard, geo-targeting)
10. Non-functional requirements (scale, offline/PWA, security, i18n)
11. Phased roadmap
12. Open decisions still to make

Legend for feature status:
- ✅ **Exists** — already built in current NEXUS, will be kept/migrated
- 🔁 **Evolve** — exists but must be generalized from "sanitation-only / Northern" to "all-hazard / nationwide"
- 🆕 **New** — net-new for v2.0

---

## 1. Vision & the pivot

### 1.1 What we have today
The current NEXUS is an **AI-powered sanitation intelligence platform for Northern
Ghana**, built for the UNICEF hackathon. It already does a lot:
- Real-time sensor monitoring + AI overflow prediction
- Flood assessments triggered by rainfall thresholds
- Full fecal-sludge chain tracking (toilet → gatherer → facility)
- AI hygiene educator (Gemini), weather heatmaps, community health scores
- WhatsApp/SMS field reporting, emergency broadcasts, vulnerability scoring
- Next.js dashboard with ~15 pages, Express backend with 26 controllers / 20 models

### 1.2 The pivot (what you asked for)
Grow from **one region, one sector** to **one country, all disasters**:

| Dimension | From (today) | To (v2.0) |
|-----------|--------------|-----------|
| **Geography** | Northern Ghana | All 16 regions / 261 districts / down to town & village |
| **Hazard scope** | Sanitation + flood | Floods, heavy rainfall, droughts, bushfires, disease outbreaks, and a framework to add more |
| **Purpose** | Monitor & respond to sanitation | Predict, prevent, respond **and** become Ghana's standard disaster-data backbone |
| **Data** | Operational data for one team | Nationwide historical + live data, **exportable** to NGOs, researchers, government |
| **Users** | District officers, field workers | + Citizens, NGOs, researchers, government/national agencies, data consumers |
| **AI** | Gemini assistants | + Predictive hazard models, and a future **national model** trained on our own data |

### 1.3 The core insight driving this
> Ghana lacks a single standard system that continuously gathers, stores, and shares
> disaster & environmental data (past disease outbreaks, floods, bushfires, droughts).
> Advanced countries have this backbone; Ghana does not. NEXUS becomes that backbone —
> and because it owns the data, it can eventually train models that predict Ghana's
> disasters better than any generic tool.

### 1.4 Guiding principles (these constrain every design decision)
1. **Prevention over reaction** — every feature should help act *before* a disaster.
2. **Data is the asset** — collect clean, structured, geo-tagged, timestamped data always.
3. **Nationwide from day one** — no hard-coded "Northern" assumptions anywhere.
4. **Inclusive access** — works on cheap phones, weak signal, via SMS/WhatsApp/PWA, in local languages.
5. **Built to scale & be handed over** — modular, documented, heavily commented, so new devs and eventually government IT can run it.
6. **Standards-based** — align with WMO multi-hazard early-warning framework and the CAP alerting standard so we can integrate with NADMO/GMet and international systems later.

---

## 2. Rebrand — keep "NEXUS", re-expand the acronym

We keep the recognizable **N.E.X.U.S.** name but redefine what it stands for, so it
reflects the nation-wide, multi-hazard mission. Proposed expansions (pick one when we
finalize — **recommendation first**):

1. ⭐ **National Emergency & eXchange system for Universal Safety** *(recommended — captures both "emergency response" and the "data exchange/marketplace" idea)*
2. **National Environmental eXus for Unified Safety**
3. **National Early-warning eXchange for Universal Safety**

Tagline: *"Ghana's national early-warning and disaster-intelligence platform."*

Everything below is written to be brand-neutral so the final naming choice doesn't
require rework.

---

## 3. Who uses it — personas

| Persona | What they need | Primary surface |
|---------|----------------|-----------------|
| **Citizen / community member** | Report incidents, receive local warnings, learn what to do | PWA (mobile), SMS, WhatsApp |
| **Field worker / volunteer** | Collect data, run assessments, upload photos offline | PWA (offline-first) |
| **District officer (MMDA/NADMO district)** | Monitor their district, coordinate response, verify reports | Web dashboard |
| **Regional coordinator** | Oversee all districts in a region, allocate resources | Web dashboard |
| **National agency (NADMO, GMet, GHS, EPA, Fire Service)** | Country-wide situational awareness, issue official alerts | Web dashboard |
| **NGO / humanitarian** | Access data, coordinate aid, run programs | Web + Data Hub |
| **Researcher / academic** | Request datasets, study patterns | Data Hub |
| **Government / policymaker** | Reports, trends, decision support | Web dashboards + exports |
| **Data consumer (any)** | Browse/download/request open datasets & APIs | Data Hub (public) |
| **Platform admin** | Manage users, roles, config, data quality | Admin panel |

---

## 4. The full feature catalog

Features are grouped into **modules**. Each module maps directly to a backend feature
folder and a frontend section (see §7). Sub-features are bulleted; status tags show what
we keep vs. build.

### Module A — Identity, Access & Geography (foundation)
The base every other module depends on.

- 🔁 **Authentication** — JWT (RS256), email/password, refresh tokens. *Evolve:* add phone-number + OTP login for citizens.
- 🆕 **Multi-role RBAC** — roles from §5, permission checks per module/action, scoped to geography (a district officer only sees their district).
- 🆕 **National geography service** — canonical hierarchy: `Country → Region (16) → District/MMDA (261) → Zone/Constituency → Town/Community/Village`. Everything (reports, hazards, alerts, datasets) is tagged to a place in this tree. Mirrors NADMO's own structure (national → 16 regional → 261 district → 900+ zonal offices).
- 🆕 **Organizations & teams** — NGOs, agencies, assemblies as first-class org entities; users belong to orgs; data ownership tracked per org.
- 🆕 **Account verification & vetting** — citizens self-serve; officials/NGOs/researchers require approval (needed for request-gated data).
- ✅ **User management** (admin) (2026-07-09) — `GET /api/v1/admin/users` (list/search),
  `GET /:id`, `PATCH /:id/status` (activate/suspend), `POST /:id/roles` (grant a
  geography-scoped role, idempotent on a repeat grant), `GET /:id/roles`,
  `DELETE /:id/roles/:roleGrantId` (revoke). National-scope only (`user.manage`/
  `role.assign`, no geo `resolveTargetPath` — user administration isn't itself
  geo-scoped, only the role *grants* it manages are). Closes the gap where RBAC v2's
  `can()` engine had no HTTP surface to actually manage who holds what role.
- 🆕 **Audit log** — who did what, when (critical for a system government may adopt).

### Module B — Multi-Hazard Early Warning & Prediction 🆕 (the new core)
Generalizes today's flood-only logic into a hazard framework aligned with the WMO
4-pillar model (risk knowledge → monitoring/forecasting → warning → preparedness).

> **📄 Fully specced:** see [specs/01-multi-hazard-ews.md](specs/01-multi-hazard-ews.md)
> for hazard framework, event state machine, hybrid prediction pipeline, CAP severity,
> impact-based forecasting, tiered warning authority, data model, APIs & jobs.

- 🆕 **Hazard registry** — pluggable hazard types: `flood`, `heavy_rainfall`, `drought`, `bushfire`, `disease_outbreak`, `windstorm`, `extreme_heat`, `sanitation_failure` (existing), extensible via config so new hazards don't need code rewrites.
- 🆕 **Hazard event lifecycle** — every event: `predicted → watch → warning → active → response → recovery → closed`, with severity levels (info/advisory/watch/warning/emergency) and confidence scores.
- 🔁 **Flood prediction** — evolve existing rainfall-threshold flood assessments into a nationwide model using rainfall + historical flood zones + terrain.
- 🆕 **Heavy-rainfall prediction** — ingest forecasts (Open-Meteo now; GMet integration later), flag districts crossing rainfall thresholds N hours ahead.
- 🆕 **Drought monitoring** — track rainfall deficits, dry-spell length, temperature anomalies per district over time.
- 🆕 **Bushfire risk** — dry-season + temperature + vegetation-dryness index; later integrate satellite fire data (e.g. NASA FIRMS).
- 🆕 **Disease-outbreak risk** — surface case-count spikes from the Health module (§D) as hazard events; align with Ghana's IDSR/DHIMS2 categories.
- 🆕 **Risk knowledge layer** — per-place vulnerability + exposure profiles (population, past events, infrastructure) so warnings can be **impact-based** ("flood likely to affect 3 schools + 1 clinic"), not just hazard-based.
- 🔁 **Prediction engine abstraction** — a `PredictionService` interface so today's Gemini/heuristic predictions and tomorrow's Python ML models are swappable (see §6).
- 🆕 **Automated triggers** — cron/stream jobs that watch data and auto-raise hazard events + draft alerts for human approval.

### Module C — Nationwide Data Gathering & Incident Reporting 🆕/🔁
The "always be collecting clean data" engine — includes citizen crowdsourcing.

- 🔁 **Field assessments** — generalize sanitation/flood assessments into reusable, form-driven assessments per hazard type, with photos (Cloudinary), GPS, offline capture.
- 🆕 **Citizen incident reports** — anyone can report a flood/fire/outbreak/sanitation issue via PWA, SMS, WhatsApp, or (future) voice note in local language. Geo-tagged, photo-attachable.
- 🆕 **Report verification workflow** — Ushahidi-style: submitted → triaged → verified/rejected → promoted to a hazard event if warranted. Prevents misinformation. **Trust model (decided):** (1) officers/moderators verify; (2) **reputation score** per citizen so reliable reporters get fast-tracked; (3) **corroboration threshold** — multiple independent reports of the same incident auto-raise confidence; (4) **community moderators** — trusted locals (assembly members, teachers) can pre-verify in their area.
- ✅ **Light gamification** (2026-07-09) — `badges`/`user_badges` tables (migration 0020), 5
  seeded badges (verified-count milestones 1/5/20 + reputation-score thresholds 50/100).
  `BadgeService.checkAndAward()` hooks into `ReportsService.review()` — a verification is
  the only event that can newly qualify a reporter, so it's checked right there, wrapped in
  try/catch so a badge-award failure never blocks the actual verification decision (same
  defensive pattern as N12's `checkAndActivate` hook). Award is idempotent via a
  `(user_id, badge_id)` unique constraint, same fire-at-most-once mechanism as N12's
  `protocol_activations`. `GET /api/v1/badges` (catalog) and `GET /api/v1/badges/leaderboard`
  (optional geo scope) are public — recognition is meant to be visible; `GET
  /api/v1/badges/me` requires auth. **No cash/airtime rewards**, per the decided trust
  model. Live-verified end-to-end: seeded a fresh test citizen (reputation 0), verified one
  of their reports via the real `/incident-reports/:id/review` endpoint, confirmed the
  `first_report` badge was awarded automatically with no extra call, reputation correctly
  incremented to 5, leaderboard entry correct, no duplicate award row. Cleaned up after.
- ⏸️ **Historical data ingestion** (bulk import past events, CSV/Excel, source attribution)
  — **deliberately not built now.** MASTER_PLAN §11 explicitly places this under **Phase 3**
  (Data Hub + ML service), not Phase 2 — building it now would repeat the exact "roadmap
  drift" this project already corrected once (2026-07-03 note above). Left for when Phase 3
  begins alongside the rest of the Data Hub (Module G).
- 🆕 **Structured data schemas per hazard** — every record captures the fields researchers actually need (date, location to village level, severity, casualties, damage, response, source) so exports are valuable.
- 🆕 **Data quality & dedup** — validation rules, duplicate detection, confidence/verification flags on every record (HDX-style QA mindset).
- 🔁 **Sensor/IoT ingestion** — keep existing sensor endpoints; generalize to accept any device type (waste-level, water-level, weather, air quality) with a documented device API.
- 🆕 **Offline-first sync** — PWA queues reports/assessments locally and syncs when signal returns (matches original offline-first vision).

### Module D — Health & Disease Surveillance 🆕
Bring disease outbreaks into the platform, aligned with Ghana's existing systems.

- 🆕 **Case reporting** — clinics/field workers log suspected/confirmed cases by disease & location (cholera, malaria, measles, meningitis, etc. — IDSR priority diseases).
- 🆕 **Outbreak detection** — threshold + trend spikes per district raise a `disease_outbreak` hazard event.
- 🆕 **Line-list & contact-tracing-lite** — optional lightweight case tracking (inspired by SORMAS) without duplicating national systems.
- 🔁 **Sanitation↔health linkage** — connect sanitation failures/flood contamination to disease risk (this is already the project's original thesis — now formalized).
- 🆕 **Health facility registry** — clinics/hospitals as geo-tagged assets for impact-based warnings.
- 🆕 **Interop-ready** — design exports/fields to be compatible with DHIMS2 categories so the platform can complement, not fight, existing health IT.

### Module E — Sanitation (existing domain, now a module) ✅🔁
Everything NEXUS already does, preserved and folded in as one hazard/sector module.

- ✅ **Sanitation unit monitoring** + AI overflow prediction
- ✅ **Fecal-sludge chain** — job lifecycle (toilet → gatherer → facility → treatment)
- ✅ **Toilet registry** — verification, QR codes, condition tracking
- ✅ **Gatherers roster** — availability, completion rates
- ✅ **Treatment facilities** registry
- ✅ **Illegal dump sites** — with AI severity analysis
- ✅ **Schools MHM** (menstrual hygiene management) metrics
- ✅ **Community health scores** — algorithmic district sanitation index
- 🔁 **Generalize scope** — extend from Northern districts to any district; keep UNICEF/child-focus features as they're strong differentiators.

### Module F — Alerts, Broadcasts & Notifications 🔁🆕
From "emergency broadcast feed" to a real geo-targeted, multi-channel alerting system.

- 🔁 **Alert management** — real-time alerts from sensors/hazards with AI recommendations (exists) → generalized to all hazard types.
- 🆕 **CAP-compliant alerts** — structure alerts on the Common Alerting Protocol (event, severity, urgency, certainty, area polygon/geocode, instructions). Makes us interoperable with national/international systems.
- 🆕 **Geo-targeted broadcasts** — target an alert to the whole nation, a region, a district, a town, or a drawn polygon. This is the "nationwide OR select-area broadcast" you described.
- 🔁 **Multi-channel delivery** — in-app + push (PWA web-push) + SMS (Arkesel) + WhatsApp (Meta) + email. Design a channel abstraction so cell-broadcast can be added if a telco/government partnership happens.
- 🆕 **Subscriptions & preferences** — citizens subscribe to their region/district/town and choose channels + language.
- 🆕 **Alert approval workflow** — auto-drafted alerts require an authorized officer to approve before mass send (prevents false alarms).
- ✅ **AI-generated alert copy** — Gemini writes plain-language, localized warning text (exists for broadcasts).
- 🆕 **Delivery tracking** — sent/delivered/read metrics per broadcast.

### Module G — Data Hub (open + request-gated exchange) 🆕 (major new pillar)
The HDX-style data-sharing platform — our path to national relevance & sustainability.

- 🆕 **Dataset catalog** — browsable, searchable datasets (by hazard, location, time range, format, license, source) with rich metadata.
- 🆕 **Three sharing modes** (HDX model): **Public** (open download), **By-request** (approval workflow), **Private** (org-internal).
- 🆕 **Data request workflow** — an NGO/researcher requests a gated dataset → owner/admin approves/denies → access granted with terms. Full audit trail.
- 🆕 **Export formats** — CSV, GeoJSON, Excel, PDF reports; scheduled/one-off.
- 🆕 **Public Data API** — documented REST API + API keys so partners can pull data programmatically (e.g. "flood patterns for Region X, 2015–2025").
- 🆕 **Licensing & attribution** — each dataset carries a license (open/CC, restricted) and required attribution.
- 🆕 **Privacy & anonymization** — automatic PII stripping / aggregation for public tiers (citizens' personal data never leaks).
- 🆕 **Dataset QA/curation** — admin review before a dataset goes public (metadata completeness, integrity), mirroring HDX's manual QA.
- 🆕 **Usage analytics** — who downloaded/requested what; demonstrates impact to funders/government.

### Module H — Maps & Geospatial Intelligence 🔁
- ✅ **Map explorer** — Leaflet + GeoJSON layers (toilets, facilities, flood zones, vulnerability) — legacy, sanitation-scoped.
- 🔁 **National multi-hazard map** — backend GeoJSON done (`/api/v1/hazard-map/*`, live-verified 2026-07-04); frontend rendering still pending.
- 🆕 **Live situational map** — active hazard events via `/api/v1/hazard-map/events`; citizen reports/SOS/dispatch tasks not yet merged into one live feed (frontend concern once it exists).
- ✅ **Historical playback** (2026-07-09) — `GET /api/v1/hazard-map/events?asOf=<ISO8601>` reconstructs which events were active, and in what state, at a past moment — derived from `event_transitions` (each event's latest transition at-or-before `asOf`; `DISTINCT ON` + `ORDER BY created_at DESC`), not a snapshot table. Live-verified using DB-ground-truth transition timestamps (not client clocks — a ~1.3s clock skew between the local dev machine and the Neon DB server was discovered and worked around during verification): confirmed state at 3 different points in an event's lifecycle, confirmed a since-closed event correctly disappears, confirmed a not-yet-created event correctly doesn't appear.
- ✅ **Admin boundary layers** (2026-07-09) — `GET /api/v1/geography/:id/boundary` (single) and `GET /api/v1/geography/boundaries?level=&region=` (bulk FeatureCollection) expose `places.boundary`, stored since the Phase 0 geography seed but never served over HTTP until now. Live-verified: 261 district boundaries returned, Guan (the tracked no-geometry gap) correctly flagged `hasGeometry: false` rather than dropped, unknown place id 404s.

### Module I — Weather & Climate 🔁
- ✅ **Real-time weather** (Open-Meteo) + 24h precipitation/temperature heatmaps + AI briefings.
- 🔁 **Nationwide coverage** — all districts, not just Northern.
- 🆕 **Forecast ingestion & storage** — persist forecasts vs. actuals to build our own historical climate dataset (feeds the future model).
- 🆕 **GMet integration (planned)** — official Ghana Meteorological Agency data when a data-sharing agreement is possible.

### Module J — AI Assistants & Intelligence 🔁🆕
(See §6 for the full AI/ML strategy; these are the user-facing AI features.)
- ✅ **AI educator** — Gemini hygiene/safety chatbot → 🔁 broaden to all-hazard preparedness advice, localized.
- ✅ **AI news feed** — curated WASH/flood news + sentiment → 🔁 broaden to all-hazard news, nationwide.
- ✅ **AI severity analysis** — dump-site/report severity scoring → 🔁 generalize to any incident photo/text.
- ✅ **AI briefings** — plain-language weather/situation summaries.
- ✅ **AI report triage assistant** (2026-07-09) — `POST /api/v1/incident-reports/:id/triage`
  (`report.verify`-gated, geo-scoped, advisory only — never mutates the report; the officer
  still calls the existing `/review` to actually decide). Reuses the legacy
  `services/geminiService.js` model-fallback/retry logic (CJS interop) rather than
  duplicating it; gracefully degrades to a structured `available:false` response (never a
  500) if `GEMINI_API_KEY` is unset or the call fails. Live-verified: correct 200 shape on
  both a plausible and a vague report, report status confirmed unchanged after the triage
  call, 404 on an unknown report id, 401 unauthenticated. **Not verified: an actual
  successful Gemini response** — the shared free-tier API key's quota was exhausted across
  both fallback models at test time (`429` on `gemini-2.5-flash` and `gemini-2.0-flash`),
  same class of external, user-actionable blocker as the expired `WHATSAPP_TOKEN` noted
  earlier — the code path that handles it (graceful `available:false` instead of a crash)
  is what's actually been proven correct here.
- 🆕 **Natural-language data query (future)** — "show me cholera cases near flooded areas in 2024" over the Data Hub.

### Module K — Analytics, Reports & Decision Support 🔁
- ✅ **District PDF/CSV reports** + trend charts → 🔁 national + regional + district levels.
- ✅ **Executive dashboard** (2026-07-09) — `GET /api/v1/analytics/executive-summary?scope=<placeId>`:
  active hazards by severity, 30-day incident-report totals (verified/pending), 30-day
  disease-case counts by disease, dispatch-task counts by status, 30-day SOS stats (open/
  acknowledged/avg-ack-seconds), shelter occupancy (open/full/closed + capacity/occupancy
  totals), active vulnerable-persons count — one Promise.all-ed cross-module read over 7
  existing tables, geo-scoped via the same ltree subtree pattern as everywhere else. New
  `analytics.read` permission granted to national_agency/regional_coordinator/
  district_officer/ngo_partner/researcher.
- ✅ **Impact & response metrics** — folded into the executive dashboard above (dispatch
  status counts, SOS ack latency, shelter/relief occupancy) rather than a separate feature.
- 🔁 **Community/district health & risk scores** — generalized composite risk index per place.
- ✅ **Trend analytics** (2026-07-09) — `GET /api/v1/analytics/trends?months=&scope=`: monthly
  hazard-event counts by type, national rollup when `scope` omitted (requires unscoped
  `analytics.read`, i.e. national-level roles). Live-verified: full executive-summary against
  seeded Tolon test data (all 7 stat groups matched expected counts exactly), scope-required
  400, unauthenticated 401, out-of-range `months` 400, national no-scope trends 200 for
  super_admin. Test rows seeded via direct SQL (not the API) to avoid triggering SOS's real
  SMS fan-out to responders — this is a pure read-aggregation feature, not a re-test of SOS.

### Module L — Admin, Config & Platform Ops 🔁🆕
- ✅ **Demo simulator** — keep for demos/onboarding (sensor spike / flood / full scenario).
- 🔁 **User & role management** — with geographic scoping.
- ✅ **Hazard-type & threshold config** (2026-07-09) — `PATCH /api/v1/hazards/types/:code`,
  previously only editable via the `seed-hazard-types.ts` CLI. `config.manage`-gated,
  audited. Live-verified: patched drought's `rainfall_deficit_pct`/`dry_days`, confirmed
  the change persisted, reverted, confirmed an unknown type 404s.
- 🔁 **Content management** — educational content, preparedness guides, blog (exists,
  legacy) — multilingual i18n still not started.
- ✅ **Integration status visibility** (2026-07-09) — `GET /api/v1/admin/integrations-status`:
  read-only, reports `configured: boolean` + non-secret metadata per integration (Arkesel,
  Gemini, Gmail, WhatsApp, FIRMS, Copernicus, Google Maps, alert signing, Cloudinary),
  never secret values. **Deliberately not built:** an HTTP-editable secrets table — that
  would be a real security regression over the current env-var model for no operational
  benefit; secrets stay in `.env`.
- ✅ **System health & job monitoring** (2026-07-09) — `GET /api/v1/admin/system-health`:
  DB connectivity+latency, applied-migration count/latest-apply-time, scheduled-hazard-jobs
  enabled flag, process uptime. Both admin endpoints `config.manage`-gated (super_admin
  only, matching this permission's existing intent), live-verified incl. a 401 check.

### Module M — Emergency Response & Coordination ✅ (2026-07-09) — backend live-verified
Moves the platform from *warning* people to *coordinating the response* — the "preparedness
& response" pillar of the WMO model. Activated when a hazard event reaches `active`/`response`.
Built as two parallel workstreams (multi-agent, same pattern as Module D) against a shared
migration/RBAC foundation (`0018_emergency_response.sql`, 7 tables) committed first, then
merged. One real bug found + fixed during live verification: `shelters.facilities` (a
`text[]` column) hit the known Drizzle gotcha where a bare JS array interpolates as a
tuple, not an array literal — fixed with the same `ARRAY[...]::text[]` helper already used
elsewhere (`notifications.repository.ts`, `volunteer.repository.ts`).

- ✅ **Shelters & safe zones** — geo-tagged registry, capacity/occupancy tracking that
  **auto-transitions status** (`open ↔ full`, never auto-reopens a `closed` shelter), a
  public unauthenticated `GET /shelters/nearest?lng=&lat=` (PostGIS KNN) for citizens
  during an event — held to the same openness as the hazard map.
- ✅ **Relief inventory** — stock levels + distributions (`relief_stocks`/`relief_distributions`).
  `distribute()` guards against over-distribution (`Insufficient stock: requested X,
  available Y`, 400 not 500) before decrementing stock.
- ✅ **Incident dispatch & tasking** — `dispatch_tasks` + `dispatch_task_events`, a state
  machine (`open → assigned → in_progress → done`, `cancelled` from any non-terminal state)
  structurally identical to the hazard-event lifecycle (`dispatch.state.ts` mirrors
  `hazards.state.ts`). **SOS (N2) now auto-creates a critical-priority dispatch task**
  (`source_type: 'sos'`) — the formal dispatch-board link the spec originally described,
  wired in after Module M existed to receive it.
- ✅ **Volunteer & resource coordination** — `volunteers`/`response_assets`, skill-based
  matching (`matchForTask`: ltree geo-match + `skills @> ARRAY[...]`) for the "match by
  proximity & skill" feature.
- ✅ **Response timeline & after-action** — `GET /api/v1/response-timeline/:hazardEventId`
  merges `dispatch_task_events` + `relief_distributions` chronologically — a read-side
  aggregation of logs that already exist, not a new duplicated log table.
- ✅ **Ties to hazards & alerts** — dispatch tasks link to `hazard_event_id`; the SOS link
  above closes the Module B/F tie described in the original spec.

**Live-verified end-to-end** (real HTTP + real DB, Neon dev branch): shelter register →
nearest-shelter lookup → occupancy adjustment with auto full/open transition; relief stock
→ over-distribution rejected (400) → real distribution linked to a hazard event; a real
dispatch task walked through its full lifecycle (`open→assigned→in_progress→done`, illegal
`done→assigned` correctly rejected); a volunteer registered, matched by skill, assigned to
the task; the response-timeline endpoint correctly merged 4 dispatch events + 1 relief
distribution in chronological order; a **real SMS SOS** (`SOS, Tolon, ...`) correctly
auto-created a linked `critical`-priority `rescue` dispatch task. Not built: a live map
view (frontend), analytics feed-in (Module K doesn't exist yet either).

### Cross-cutting capabilities (apply to all modules)
- 🆕 **Internationalization (i18n)** — English + major Ghanaian languages (Twi, Ewe, Dagbani, Ga, Hausa) for citizen-facing surfaces + AI output.
- 🆕 **Offline-first PWA** — installable, service-worker caching, background sync.
- 🆕 **Accessibility & low-bandwidth** — lightweight pages, SMS/USSD fallback paths.
- 🔁 **Real-time** — Socket.IO (already a dependency) for live maps, alerts, dashboards.
- 🆕 **Notifications infra** — one service, many channels (in-app/push/SMS/WhatsApp/email).

---

## 5. User roles & permissions matrix

Roles are **geography-scoped**: a role applies within an assigned place in the geography
tree (national scope for national agencies, a region for a coordinator, etc.).

| Role | Scope | Can do |
|------|-------|--------|
| **Super Admin** | National | Everything: config, users, data QA, all data |
| **National Agency** (NADMO/GMet/GHS/EPA/Fire) | National | View all, issue official alerts, approve gated data, publish datasets |
| **Regional Coordinator** | Region | Manage districts in region, approve alerts, view regional data |
| **District Officer** | District | Manage district data, verify reports, run assessments, request alerts |
| **Field Worker / Volunteer** | Assigned area | Collect data, run assessments, submit reports (offline), accept dispatch tasks |
| **Community Moderator** | Their locality | Pre-verify citizen reports in their area before officers see them |
| **NGO / Partner** | Assigned area(s) | View shared data, request datasets, coordinate programs, manage relief inventory |
| **Researcher** | — | Browse catalog, request gated datasets, download open data |
| **Data Consumer** (public) | — | Browse & download public datasets, use public API |
| **Citizen** | Their locality | Report incidents, subscribe to alerts, view public info, learn |

Permissions are enforced by an RBAC middleware keyed on `(role, action, resource, geoScope)`.
This must be a first-class, well-documented part of the foundation module.

---

## 6. AI & ML strategy

Two horizons, cleanly separated by an abstraction so we never have to rewrite callers.

### 6.1 Today (Phase 1–2): Gemini + heuristics
- Keep **Google Gemini 2.5 Flash** for: educator chatbot, news curation, severity analysis, alert/briefing text generation, report triage suggestions.
- Keep **rule/threshold heuristics** for predictions (rainfall thresholds → flood watch, case spikes → outbreak).
- Wrap all of this behind a **`PredictionService` / `AIService` interface** in the backend so the *how* can change without touching controllers.

### 6.2 Near future (Phase 3): dedicated ML service
- A separate **Python microservice** (FastAPI + scikit-learn/TensorFlow, matching the original PDF's stack) for real predictive models: flood risk, overflow, drought index, outbreak forecasting.
- Backend talks to it over HTTP; it's independently deployable and scalable.
- Trained initially on public/historical data + the data we ingest.

### 6.3 Long-term vision (Phase 4+): the "national model"
- As the Data Hub accumulates clean, nationwide, geo/time-tagged data (floods, outbreaks, bushfires, droughts, weather, sanitation), we use it to **train Ghana-specific models** that outperform generic tools.
- This is the compounding moat: **more usage → more data → better predictions → more usage.**
- Design decisions that make this possible *must start now*: consistent schemas, provenance, versioning, and a data lake/warehouse-friendly export path. (This is why Module C insists on structured schemas from day one.)

### 6.4 Data flywheel (the strategic thesis)
```
Citizens & field workers report  ─┐
Sensors & weather ingest         ─┤→  Clean structured data (Module C)
Historical imports               ─┘        │
                                           ▼
                         Data Hub (Module G) ──exports──► NGOs/researchers/govt
                                           │
                                           ▼
                         National ML model (§6.3) ──► better predictions (Module B)
                                           │
                                           ▼
                         better warnings ──► more trust ──► more users ──► more data ↺
```

---

## 7. System architecture & the modular monorepo

Chosen strategy: **restructure into a modular monorepo.** Keep the existing business
logic, reorganize it into clear feature modules so it scales and new devs can navigate.

### 7.1 High-level architecture
```
                    ┌─────────────────────────────────────────┐
   Citizens (PWA)   │            Client surfaces                │
   Officials (Web)  │  Next.js app (web dashboard + PWA)        │
   SMS / WhatsApp   │  + SMS/WhatsApp/USSD gateways             │
                    └───────────────────┬───────────────────────┘
                                        │ REST + WebSocket
                    ┌───────────────────▼───────────────────────┐
                    │        API Gateway (Express, v1)           │
                    │  Auth · RBAC · rate-limit · validation     │
                    └───────────────────┬───────────────────────┘
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
   Feature modules (hazards, reports, health, sanitation, alerts,
   datahub, weather, geography, analytics, ai) — each: routes →
   controllers → services → models
        │                                               │
        ▼                                               ▼
   PostgreSQL (Neon)                            ML service (Python/FastAPI, Phase 3)
   + object storage (Cloudinary)                External: Open-Meteo, GMet, SMS, WhatsApp
```

### 7.2 Repository layout (top level)
```
nexus/
├── docs/                     # this plan + architecture decision records (ADRs) + API docs
├── nexus-backend/            # Node/Express API (modular)
├── nexus-frontend/           # Next.js web + PWA
├── nexus-ml/                 # Python ML service (added in Phase 3)
├── packages/                 # (optional) shared types/constants between FE & BE
└── README.md
```

### 7.3 Backend structure (feature-module based)
Each module is self-contained: routes → controller → service → model, plus its own
validators and tests. A module can be understood (and worked on) in isolation.

```
nexus-backend/
├── server.js
├── src/
│   ├── config/               # env, database, constants (hazard types, roles, geo)
│   ├── core/                 # cross-cutting foundation
│   │   ├── auth/             # login, JWT, OTP, refresh
│   │   ├── rbac/             # roles, permissions, geo-scope middleware
│   │   ├── geography/        # region/district/town tree + lookups
│   │   ├── users/            # users, orgs, teams, verification
│   │   ├── notifications/    # channel abstraction (in-app/push/SMS/WhatsApp/email)
│   │   └── audit/            # audit logging
│   ├── modules/
│   │   ├── hazards/          # hazard registry, events, prediction engine (Module B)
│   │   ├── reports/          # citizen reports, assessments, verification (Module C)
│   │   ├── ingestion/        # sensors/IoT, bulk import, sync (Module C)
│   │   ├── health/           # disease surveillance (Module D)
│   │   ├── sanitation/       # units, sludge, toilets, gatherers, facilities, dumps, schools (Module E)
│   │   ├── alerts/           # CAP alerts, broadcasts, subscriptions (Module F)
│   │   ├── datahub/          # datasets, catalog, requests, export, public API (Module G)
│   │   ├── geospatial/       # map layers, GeoJSON, boundaries (Module H)
│   │   ├── weather/          # weather + forecasts + history (Module I)
│   │   ├── ai/               # Gemini gateway, educator, news, triage, ML client (Module J)
│   │   ├── analytics/        # scores, reports, dashboards, exports (Module K)
│   │   ├── response/         # shelters, relief inventory, dispatch, volunteers (Module M)
│   │   └── admin/            # config, simulator, content, system health (Module L)
│   ├── shared/               # middleware, errors, utils, validators, base model helpers
│   ├── integrations/         # external adapters: openMeteo, gmet, arkesel, whatsapp, cloudinary, email
│   ├── jobs/                 # cron/queue workers (predictions, ingestion, digests)
│   └── db/                   # schema, migrations, seeders
└── tests/
```

**Module internal convention** (documented once, followed everywhere):
```
modules/<name>/
├── <name>.routes.js
├── <name>.controller.js
├── <name>.service.js
├── <name>.model.js          # or models/ if several
├── <name>.validators.js
├── <name>.types.js          # JSDoc typedefs / shared shapes
└── README.md                # what this module does, its endpoints, its data
```

> **Migration note:** today's 26 controllers/20 models map cleanly onto these modules —
> e.g. `toiletController`, `gathererController`, `sludgeJobController`, `dumpController`,
> `facilityController`, `unicefController` → `modules/sanitation`; `weatherHistoryController`
> → `modules/weather`; `broadcastController`/`alertController` → `modules/alerts`;
> `newsController`/`educatorController` → `modules/ai`. So this is a *reorganization*, not a rewrite.

### 7.4 Frontend structure (Next.js App Router + PWA)
Route groups by audience; feature code colocated; PWA/offline as first-class.

```
nexus-frontend/
├── public/
│   ├── manifest.json         # PWA manifest
│   └── icons/
├── src/
│   ├── app/
│   │   ├── (public)/         # landing, about, public data hub, docs
│   │   │   ├── data/         # public dataset catalog + download (Module G)
│   │   │   └── learn/        # preparedness guides (multilingual)
│   │   ├── (auth)/           # login, register, verify, OTP
│   │   ├── (citizen)/        # citizen PWA: report, my-area, alerts, subscriptions
│   │   ├── (dashboard)/      # officials/NGOs
│   │   │   ├── overview/     # national/regional/district situational view
│   │   │   ├── hazards/      # multi-hazard events & predictions
│   │   │   ├── map/          # live + historical multi-hazard map
│   │   │   ├── reports/      # incoming citizen reports + verification queue
│   │   │   ├── health/       # disease surveillance
│   │   │   ├── sanitation/   # existing sanitation suite (units, sludge, toilets, …)
│   │   │   ├── alerts/       # create/approve/track broadcasts
│   │   │   ├── weather/      # heatmaps + forecasts
│   │   │   ├── analytics/    # dashboards, reports, exports
│   │   │   ├── datahub/      # manage datasets, requests, approvals
│   │   │   ├── response/     # shelters, relief, dispatch board, volunteers (Module M)
│   │   │   └── educator/     # AI assistant
│   │   └── (admin)/          # users, roles, config, simulator, system health
│   ├── features/             # feature-scoped hooks/components/api-clients (mirror BE modules)
│   │   ├── hazards/ reports/ health/ sanitation/ alerts/ datahub/ weather/ …
│   ├── components/           # shared UI (ui/, layout/, map/, charts/, forms/)
│   ├── lib/                  # api client, query client, auth, i18n, pwa/offline sync
│   ├── context/              # providers
│   ├── hooks/                # shared hooks
│   ├── locales/              # i18n message catalogs (en, tw, ee, dag, …)
│   └── types/                # shared TS types (ideally generated from BE)
└── next.config.ts            # + PWA/service-worker config
```

### 7.5 Documentation & maintainability (non-negotiable, per your ask)
- **Every module has a `README.md`** describing purpose, endpoints, and data.
- **Heavy inline comments** on services and any non-obvious logic; JSDoc on public functions.
- **ADRs in `docs/adr/`** — one short file per significant decision (why Postgres, why modular, why CAP, etc.).
- **OpenAPI/Swagger** spec for the API, kept in `docs/`.
- **CONTRIBUTING.md** — folder conventions, how to add a new module/hazard, coding standards.
- **Consistent conventions** so a new dev can predict where any file lives.

---

## 8. Data model — geography, hazards, datasets, alerts

Core entities (high level; full schema designed in implementation phase):

- **Geography:** `regions`, `districts`, `communities` (self-referential place tree) — every other table references a `place_id`.
- **Users & orgs:** `users`, `organizations`, `memberships`, `roles`, `permissions`, `user_geo_scope`.
- **Hazards:** `hazard_types` (config), `hazard_events` (status, severity, confidence, place, time), `predictions`, `risk_profiles` (per place).
- **Reports & data:** `incident_reports`, `assessments`, `assessment_forms`, `sensor_devices`, `sensor_readings`, `imported_records`.
- **Health:** `disease_cases`, `health_facilities`, `outbreaks`.
- **Sanitation:** existing tables (`sanitation_units`, `registered_toilets`, `sludge_jobs`, `gatherers`, `waste_facilities`, `illegal_dump_sites`, `school_sanitation_metrics`, `community_health_scores`).
- **Alerts:** `alerts` (CAP fields), `broadcasts`, `subscriptions`, `deliveries`.
- **Data Hub:** `datasets`, `dataset_versions`, `data_requests`, `api_keys`, `download_logs`, `licenses`.
- **Ops:** `audit_logs`, `notifications`, `jobs`.

Design rules: every event/record is **geo-tagged** (to village where possible), **timestamped**, **source-attributed**, and carries a **verification/confidence** flag. This is what makes exports valuable and the future model trainable.

---

## 9. Alerting & broadcast design (CAP + geo-targeting)

- **Standard:** model alerts on the **Common Alerting Protocol (CAP)** — fields for event, category, urgency, severity, certainty, effective/expiry time, affected **area (polygon or geocode)**, and instructions. This makes us interoperable with NADMO/GMet and international systems and future-proofs cell-broadcast integration.
- **Targeting:** select audience by geography tree node (nation → region → district → town) **or** by drawing a polygon on the map. Everyone whose subscription/location falls inside is notified.
- **Channels:** in-app, web-push (PWA), SMS (Arkesel), WhatsApp (Meta), email — behind one notification service. Cell broadcast is the aspirational channel that a telco/government partnership unlocks.
- **Governance:** auto-drafted alerts (from Module B triggers) always require an authorized officer's approval before mass send. Full delivery tracking + audit.

---

## 10. Non-functional requirements

- **Scale:** stateless API (horizontal scale), connection-pooled Postgres (Neon serverless), background jobs off the request path, pagination everywhere, caching for read-heavy public data/API.
- **Offline-first PWA:** service worker caching, IndexedDB queue for reports/assessments, background sync, conflict handling.
- **Low-bandwidth & inclusion:** SMS/WhatsApp/USSD fallbacks, lightweight pages, local languages.
- **Security & privacy:** RBAC + geo-scoping, input validation (express-validator), Helmet, rate limiting, secrets management, PII anonymization for public data, full audit trail. Important because government adoption demands it.
- **Reliability:** health checks, job monitoring, graceful degradation if an external API (weather/AI/SMS) is down.
- **Observability:** structured logging (morgan + app logs), error tracking, delivery/usage metrics.
- **Data governance:** dataset licensing, provenance, versioning, retention policies.

---

## 11. Phased roadmap

Each phase is shippable and demoable on its own.

### Phase 0 — Foundation & restructure  → **specced in [spec 04](specs/04-migration-plan.md); ✅ substantially DONE (2026-07-02)**
> **Built & verified on a Neon dev branch:** pnpm workspaces + TypeScript + Vitest/CI (0.1) ·
> Drizzle migrations replacing boot-time DDL (0.2) · `places` geography — 16 regions / 261
> districts, PostGIS + ltree (0.3) · orgs + geography-scoped RBAC with `can()` (0.4) ·
> phone-OTP auth + refresh tokens + account verification (0.5) · audit trail + notifications
> skeleton (0.6) · sanitation `place_id` geo-tagging + backfill (530 rows) via a district
> resolver (0.7a) · **CJS→TS runtime bridge** — new auth-v2 + geography routers live over HTTP
> under tsx, legacy API untouched (0.7b) · docs/OpenAPI/READMEs (0.8).
> **Remaining follow-ons (non-blocking):** finish moving legacy sanitation controllers into
> `modules/sanitation` as TS; resolve the 57 `"Northern"` rows; add Guan District geometry +
> district population; backend ESLint in CI.
- pnpm workspaces + TypeScript + Drizzle migrations (replace boot-time `schema.sql`); Vitest/CI.
- Normalized `places` geography (16 regions / 261 districts, PostGIS) replacing the `district` string.
- RBAC + geo-scoping + orgs; phone-OTP auth (Arkesel) alongside email/password; audit log.
- Migrate existing sanitation features into `modules/sanitation`, backfilled to `place_id`, **no behavior change**.
- Docs skeleton done (ADRs, CONTRIBUTING, specs). See spec 04 for the step-by-step + Definition of Done.

> **Also folded into the foundation (from Module N / spec 02):** design the alert path for
> **resilient/degraded-mode operation (N8)** and **guaranteed, acknowledged delivery (N9)** —
> these are reliability requirements, not later features.

### Phase 1 — Multi-hazard core + nationwide  → **status as of 2026-07-04 (honest checklist)**
> **Agreed sequencing (2026-07-03):** finish remaining Phase 1 gaps in order — drought ✅ →
> GloFAS (floods) ✅ → national multi-hazard map ✅ → vulnerable-persons registry (N4) ✅ →
> citizen SMS intake ✅ — before returning to Phase 2. (PWA/frontend intake is a separate,
> larger, not-yet-started body of work — see below.)
- [x] Hazard registry + event lifecycle (config-driven, CAP-classified, state machine)
- [x] Generalize flood logic (generic evaluator pattern — any hazard is a config row + evaluator)
- [x] Heavy-rainfall monitoring (Open-Meteo, live-verified)
- [x] **Drought monitoring** — live-verified 2026-07-04: 30-day rainfall vs. a 3-year rolling
      normal (Open-Meteo historical archive, no key); real result found — "Drought watch —
      Upper West" (55.9% deficit). True CHIRPS climatology remains a future upgrade.
- [x] FIRMS (bushfire) — live-verified, scheduled
- [x] **GloFAS (floods)** — live-verified 2026-07-04: forecast river discharge vs. 10-year
      daily-percentile thresholds (GloFAS v4 data via Open-Meteo's Flood API, no key — avoids
      the raw CDS/netCDF/Python path originally anticipated). Real result: **5 flood watches,
      all in southern/coastal Ghana** (Greater Accra, Ashanti, Central, Eastern, Western) —
      geographically coherent with July's rainy-season belt, while the drought hit was in the
      north (Upper West) — independent cross-validation that both evaluators are tracking real
      signal. Daily-percentile proxy for GloFAS's own return-period levels (future upgrade).
- [x] **National multi-hazard map** — backend GeoJSON live-verified 2026-07-04:
      `/api/v1/hazard-map/{events,districts,summary}` (mounted separately from the legacy
      asset-layer `/api/v1/map`). District choropleth aggregates region-level events down to
      every district via ltree; on real data this correctly lit up **174 districts** across
      the affected regions from just 8 underlying events. Frontend rendering still pending.
- [x] Citizen incident reporting + verification workflow — **backend only**
- [x] **Citizen reporting via SMS** — live-verified 2026-07-08: `REPORT <type>, <place>,
      <description>` grammar (`modules/reports/sms/report-sms.parser.ts`), inbound webhook
      `/api/v1/sms-intake/inbound` reuses `GeographyService.resolveDistrict` (fuzzy district
      match) and `ReportsService.submit` — no report-creation logic duplicated. Arkesel's
      two-way inbound payload format isn't publicly documented (their product for it is
      "KOVA IQ"), so `integrations/arkeselInbound.ts` normalizes via a defensive multi-alias
      adapter rather than assuming an unverified schema — documented prominently as the one
      file to update once a real payload is captured. Verified over real HTTP against all 4
      cases: well-formed normalized `{from,text}` payload → report created + confirmation SMS;
      Arkesel-alias-shaped `{sender,message}` payload → normalizes identically; malformed text
      → graceful HELP-text reply, no report created; fully unparseable payload → 200 with a
      failure message (no webhook retry storms). Optional `SMS_INBOUND_TOKEN` shared-secret
      guard (open if unset — dev-friendly, must be set in production).
- [ ] **Citizen reporting via PWA / WhatsApp** — SMS intake done; PWA (frontend) and WhatsApp
      keyword intake remain not started ← **next candidate, or return to Phase 2**
- [x] **Life-safety Tier 1 start: vulnerable-persons registry (N4)** — live-verified 2026-07-05:
      `/api/v1/vulnerable-persons/*`, geo-scoped RBAC (no endpoint ever lists "everyone
      nationally" — every list requires an explicit scope place, permission-checked against
      it), explicit consent tracking, evacuation-priority sorting, every mutation audited.
      Verified over HTTP: unauth→401, no-permission citizen→403, register→201, a
      Greater-Accra-scoped list correctly excludes a Northern record (geo-isolation proven),
      status update→200. `vulnerable.manage` restricted to district_officer+ (field workers
      get create+read only — can't unilaterally mark someone deceased).

> **⚠️ Sequencing note:** development did **not** follow this phase order. We built one
> hazard vertically end-to-end (detect → classify → impact → CAP warning → tiered publish →
> in-app + SMS fan-out) to prove the whole architecture, which pulled in **Phase 2 items**
> (CAP alerts, N9 guaranteed delivery/SMS) before Phase 1 was finished. That was a deliberate
> engineering choice (prove one thread fully before going broad) but it was never reconciled
> back against this document until 2026-07-03. Treat the checkboxes above, not the prose
> below, as the source of truth for what's actually built.

### Phase 2 — Alerts, health & citizen engagement  → **partially pulled forward into Phase 1 (see note above)**
- [x] CAP alerts + tiered publish authority + subscriptions
- [x] SMS fan-out (**N9** guaranteed-delivery groundwork — in-app + SMS; push/WhatsApp/voice still open)
- [x] **Geo-targeted multi-channel broadcasts — email + WhatsApp** (2026-07-08). Extends
      the existing SMS fan-out (`AlertsService.publish()`) with the same
      subscribe/opt-out pattern per channel (`subscriptions.channels` + `notification_preferences`
      already supported all six channels in the schema — only the SMS branch was actually
      implemented before this). `integrations/email.ts` (nodemailer/Gmail app-password,
      dev-mode log fallback) and `integrations/whatsapp.ts` (Meta Cloud API, same fallback
      pattern) mirror `integrations/arkesel.ts` exactly. `warnings` table gained
      `whatsapp_attempted/delivered` + `email_attempted/delivered` counters (migration 0013).
      **Live-verified with a real send:** published a real alert to a subscriber using the
      user's own email — `email_attempted:1, email_delivered:1` (actual Gmail send
      confirmed, message received). WhatsApp fan-out is fully wired and unit/integration
      tested (`attempted:1`) but not yet delivering: the adapter initially read the wrong
      env var name (`WHATSAPP_PHONE_ID`; fixed to match the legacy WhatsApp bot's actual
      `WHATSAPP_PHONE_NUMBER_ID`), and after that fix a real send attempt against Meta's
      Cloud API still failed with `OAuthException` code 190 (Authentication Error) — the
      configured `WHATSAPP_TOKEN` is expired/invalid, a real external credential issue the
      user needs to refresh in their Meta Developer console, not a code bug. Push
      (web-push/PWA) and voice remain genuinely not started — push has a `push_subscriptions`
      table already in the schema (Phase 0) but no subscribe endpoint or PWA to call it, and
      building backend-only send logic with nothing to receive it would be unverifiable
      busywork; deferred until the PWA exists.
- [x] **Signed alerts (N10)** — live-verified 2026-07-08: published alerts are signed with
      an Ed25519 keypair (`modules/alerts/alerts.signing.ts`, Node's built-in `crypto`, no
      new dependency) over a canonical (recursively key-sorted) encoding of the CAP payload,
      so re-serialization order never breaks verification. `GET /api/v1/warnings/public-key`
      (no auth) exposes the public key so anyone can verify independently rather than
      trusting the server's own claim — the actual anti-spoofing property, not just a
      decorative "Verified" badge. `GET /api/v1/warnings/:id/verify` (no auth) recomputes
      the CAP payload from the current DB row and checks the signature against it. **Proved
      genuinely tamper-evident, not just present:** published a real alert (`verified:true`),
      then directly mutated the stored headline in the DB (simulating a compromised row) and
      re-verified — correctly flipped to `verified:false`. `warnings` gained
      `signature`/`signing_key_id`/`signed_at` (migration 0014). Signing is skipped
      gracefully (dev-mode, alert still publishes) if `ALERT_SIGNING_*` env vars are unset.
- [x] **Last-mile community/radio channels (N6)** — live-verified 2026-07-09. Sirens/PA
      hardware and live radio-broadcast automation have no integratable API (genuinely
      out of scope for a software platform); built what IS buildable — a registry of
      human/institutional relay points (`community_focal_points`: focal persons, radio
      stations, notice-board locations) that `AlertsService.publish()` fans out a
      **broadcast-ready script** to via the same already-built SMS/email adapters,
      separate from personal subscriber opt-in (a focal point's whole job is reaching
      people with no phone/signal, so it's not gated the same way). Also added a public
      **printable notice-board sheet** (`GET /api/v1/warnings/:id/notice-sheet`,
      self-contained HTML, no auth) for physical posting. `warnings.focal_points_notified`
      counter, migration 0017. Live-verified: registered a real focal point (radio
      station + contact), published a real alert, confirmed real SMS + email delivery of
      the broadcast script (distinct wording from the subscriber SMS/email formats),
      fetched the live notice-sheet HTML, and confirmed the officer list view + a 401 on
      unauthenticated registration.
- [x] **"I'm Safe" check-in (N1)** — live-verified 2026-07-08. Tier-1 life-saving
      priority (spec 02's own prioritization). SMS is the primary
      channel (no smartphone/app required) — `SAFE, <place>` / `HELP, <place>` /
      `INJURED, <place>`, optionally `, <name>` for a community focal person checking in
      someone else on their behalf (the N6 "last-mile human network" pattern, built ahead
      of N6 itself). Routed through the **same shared inbound SMS webhook** as citizen
      reports (`/api/v1/sms-intake/inbound`) — a real provider posts every message to one
      URL, so dispatch-by-keyword happens there rather than a second webhook. A check-in
      **auto-links to the most recent open hazard event covering that place** (ltree
      ancestor match) without the sender needing to know an event ID — never rejected for
      lack of context, only for an unresolvable place (nothing useful to aggregate a
      place-less check-in into). `GET /api/v1/safety-checkins/event/:id/summary` gives
      officers the aggregated "who's accounted for" view spec 02 describes. Deliberately
      **no verification/trust gate** on check-ins (unlike incident reports) — a false "I'm
      safe" is far less dangerous than a missed one. Live-verified with a real SMS to the
      user's own phone: self check-in auto-linked to a real open event, an on-behalf-of
      check-in captured the subject's name correctly, aggregated summary matched
      (`safe:1, need_help:1`), unauthenticated access to the officer view correctly 401'd.
      `safety_checkins` table, migration 0015.
- [x] **SOS / panic button (N2)** — live-verified 2026-07-08, dispatch-linked 2026-07-09.
      Originally shipped ahead of Module M (which didn't exist yet), so v1 achieved the
      "minutes matter" goal via **immediate SMS + in-app notification of every responder**
      whose role/geo-scope covers the affected place (`sos.repository.ts`'s
      `findResponderCandidates()`: national grants or an ancestor geo-scope, filtered to
      `sos.manage`-holding roles via the pure `roleHasPermission()`). **Now that Module M
      exists, `raise()` also auto-creates a critical-priority dispatch task** — the formal
      dispatch-board link the spec always described, closing that gap. `sos_alerts.geometry` is
      `Point` **NOT NULL** — the whole point of N2 is precise location, so unlike N1 an
      unresolvable place is rejected outright (asked to retry) rather than recorded
      without one. SMS is the fallback channel (`SOS, <place>, <what is happening>`,
      resolved to the district's centroid — raw SMS can't carry live GPS);
      `POST /api/v1/sos` is the "big red button" endpoint for a future PWA posting real
      `navigator.geolocation` coordinates. **Live-verified with real SMS delivery to real
      responders**: sent a live SOS via SMS, which correctly notified 2 geo-eligible
      officers by real SMS (`responders_notified:2`, confirmed via safe test numbers
      substituted for two demo/seed accounts' phone numbers — originals restored
      afterward), plus the officer read/acknowledge/resolve lifecycle and a 401 check.
      `sos_alerts` table, migration 0016.
- [x] **Disease surveillance module (Module D)** — live-verified 2026-07-08: case reporting
      (`/api/v1/health-cases`) + a health-facility registry (`/api/v1/health-facilities`),
      built as two parallel workstreams (multi-agent) against a shared migration/RBAC
      foundation, then merged and wired together. `disease_cases` is epi-aggregate only
      (age_group/sex, no patient names — data minimization). An outbreak-detection
      evaluator (`modules/hazards/evaluators/outbreak.ts`) computes a z-score of the
      current week's case count vs. a rolling weekly baseline per (disease, place) and
      raises/updates the existing `disease_outbreak` hazard type — same evaluator pattern
      as drought/flood/bushfire, weekly cron cadence. Seeded with 11 Ghana IDSR priority
      diseases (cholera, AWD, measles, meningitis, yellow fever, guinea worm, AFP/polio,
      neonatal tetanus, VHF, anthrax, rabies). Live-verified end-to-end: facility
      register/list/update, case report with FK-validated disease code (unknown code →
      graceful 400, not a 500), unauthenticated → 401, and a synthetic case-spike
      injection that correctly triggered the evaluator to auto-raise a `severe`
      `disease_outbreak` watch (z=19) — then cleaned up. Not yet built: line-list /
      contact-tracing (optional per spec), DHIMS2 interop export.
- [x] **Missing persons & family reunification (N3)** — live-verified 2026-07-09.
      Report a missing person; `GET /:id/matches` runs `pg_trgm` fuzzy `similarity()`
      (threshold `>0.3`) against N1 safety check-ins and N4 vulnerable persons, scoped to
      the record's own place subtree, returning ranked candidates from both sources —
      matching is candidate discovery only, a human with `missing.manage` confirms via
      `PATCH`. No forward-only state machine (unlike dispatch/hazard events): any officer
      can move between `missing/found/reunified/closed`, stamping `resolved_by`/
      `resolved_at` on resolution. `missing_persons` table, migration 0019. Live-verified:
      reported "Abena Mensa" against a seeded check-in "Abena Mensah" → matched at
      similarity score 0.79, resolved via PATCH, scope-required 400, unauthenticated 401.
- [x] **Rumor & misinformation control (N11)** — live-verified 2026-07-09. Rumor intake
      (`rumor_reports`, citizens+) → officer review (`reported → reviewing →
      confirmed_false/confirmed_true/clarified`) → an official myth-vs-fact clarification
      (`myth_fact_entries`) that fans out to the N6 community focal-point network — the
      exact same last-mile channel `AlertsService.publish()` uses (real SMS/email to every
      active focal point covering the scope) — plus a public, unauthenticated feed so
      citizens can read clarifications directly. `place_id` is nullable on a rumor report
      (a phoned-in rumor may have no resolvable location); an unscoped rumor requires a
      national-level `rumor.manage` grant to review. Migration 0019. Live-verified: rumor
      reported → reviewed (`confirmed_false`) → myth-fact published with a real SMS sent to
      a registered focal point (`channels_notified: {focalPointsNotified:1}`) → public feed
      + detail both readable with no auth.
- [x] **Anticipatory action / forecast-based triggers (N12)** — live-verified 2026-07-09,
      the "predict and prevent" mission's concrete engine. A **protocol** is a pre-agreed
      rule: if a hazard event of `hazard_type` reaches `trigger_state` in a place (or a
      descendant place), automatically run configured `actions` — pre-alert focal points,
      flag vulnerable persons for evacuation priority, log a relief pre-positioning
      recommendation. **`HazardService.transition()` now calls `checkAndActivate()` after
      every state change** (migration 0019's `(protocol_id, hazard_event_id)` unique
      constraint guarantees fire-at-most-once per event; a Postgres `23505` on that
      constraint is treated as a safe no-op, not an error) — genuinely automatic, not a
      polling job. Relief pre-positioning is honestly scoped as a **logged recommendation
      for a human to action**, not an automatic stock transfer (real inventory movement
      would require importing the relief module — same "deliberately scoped" honesty
      pattern as sirens/PA hardware in N6). **Live-verified as a real end-to-end trigger,
      not just CRUD:** configured a flood/watch protocol for Tolon, raised a hazard event at
      `predicted`, called `POST /transition` to `watch` with zero extra wiring at the call
      site — the protocol fired automatically, sent a real SMS to a registered focal point
      (`notified:1`), correctly found 0 active vulnerable persons in scope, and logged the
      relief note, all visible via `GET /anticipatory/activations`.
      Built as three independent parallel-agent worktree builds (N3/N11/N12) off one shared
      migration+RBAC commit — first time this session all three worktrees landed with **zero
      merge conflicts**, including on `container.ts`/`register.ts`, because agents were
      scoped to their own new module directories only and the orchestrator (this session)
      did all cross-cutting wiring itself afterward in one pass.
- [x] **Rapid damage & needs assessment (N15)** — live-verified 2026-07-09.
      `POST /api/v1/assessments` (geo-tagged post-event household/casualty/urgent-needs
      capture) + `GET /assessments/sitrep?scope=` (a live situation report — SUM
      aggregation of households/persons/casualties/injuries affected, plus an
      urgent-needs breakdown via `unnest()`/`GROUP BY`). `damage_assessments` table,
      migration 0021. Live-verified: two seeded assessments summed correctly
      (55 households, 240 persons, 1 casualty, 7 injuries) and the urgent-needs
      breakdown matched exactly (water:2, shelter:1, medical:1, food:1).
- [x] **Health-facility capacity & mass-casualty coordination (N16)** — live-verified
      2026-07-09. Extends the existing health-facility registry (not a new module) with
      a live capacity time series: `POST /:id/capacity` (beds/blood-units/ambulances +
      `normal|strained|overwhelmed|closed` status, insert-only — every report is a new
      row, not an in-place update, preserving history), `GET /:id/capacity` (latest
      report; `200 {data:null}` is a valid "never reported" state, only an unknown
      facility 404s), `GET /nearest-with-capacity` (public, no auth — PostGIS KNN over
      each facility's latest report, mirrors `shelters`' `/nearest`; routing a
      mass-casualty event to a facility that actually has room is the same openness
      level as routing evacuees to an open shelter). Live-verified: capacity report
      filed, latest-report lookup correct, and the public nearest-with-capacity query
      found the test facility with the right bed count and distance.
      N15/N16, plus **admin user & role management** (Module A/L gap, see Module A's
      entry above), were the third batch of parallel-agent worktree builds this
      session — again zero merge conflicts, same directory-scoped-agents +
      centralized-orchestrator-wiring pattern established in the N3/N11/N12 batch.
- [ ] PWA offline-first hardening (**degraded-mode, N8**)
- [ ] i18n (first local languages)

### Phase 3 — Data Hub + ML service
- Dataset catalog, public/by-request/private sharing, data-request workflow, public API, licensing, anonymization.
- Historical data ingestion (import past disasters).
- Python ML service; move predictions from heuristics/Gemini to trained models.

### Phase 4 — National model & partnerships
- Train Ghana-specific models on accumulated data; natural-language data query.
- Integrations with GMet/NADMO/GHS where agreements allow; government onboarding.
- Sustainability model (per §12).

> Ordering rationale: we build the **data-collection spine first** (Phases 0–2) because
> everything valuable later — the Data Hub and the national model — depends on clean data
> flowing in from day one.

---

## 12. Open decisions still to make

These don't block starting Phase 0, but we should settle them soon:

1. **Final acronym expansion** — pick from §2 (recommend option 1).
2. **Sustainability model** — you chose HDX-style open + request-gated sharing (free/mission).
   Later, do we add a paid API/premium tier for revenue (per the original PDF), or stay
   fully open and fund via government/NGO/grants? Affects Data Hub billing design.
3. **Hosting & infra** — stay on Neon + (Vercel for FE / Render/Railway/Fly for BE)? Where does the Python ML service live? Object storage: keep Cloudinary or move to S3-compatible for large datasets?
4. **Geography data source** — official Ghana region/district/community boundary GeoJSON + population figures (for impact-based warnings). Need to source these.
5. **Local languages** — confirm the priority set (Twi, Ewe, Dagbani, Ga, Hausa?) and how AI localizes.
6. **Institutional partners** — early conversations with NADMO/GMet/GHS shape data interop and credibility. Who do we approach first?
7. ~~**IoT hardware**~~ — **Decided:** design for IoT as one of four data sources (documented device ingestion API); build it in Phase 2–3, software+citizen data first.
8. **Native mobile later?** — PWA now (decided); revisit a native app if app-store presence/push reliability becomes a constraint.

**Resolved in detailed planning (2026-07-02):** Emergency Response module = full (shelters + dispatch + volunteers, Module M) · Citizen trust = verification + reputation + corroboration + community moderators, light gamification only · Data sources = all four · EWS specifics = see [spec 01](specs/01-multi-hazard-ews.md). New module-level open questions live at the bottom of each detailed spec (e.g. spec 01 §17: PostGIS availability, GloFAS/FIRMS keys, population data source, disease baselines, drought normals).

---

## Appendix A — Sources informing this plan
- Ghana NADMO structure & flood/bushfire early-warning coordination (NADMO, GMet, WRC): https://www.nadmo.gov.gh/ , https://www.mint.gov.gh/agencies/national-disaster-management-organization/
- WMO multi-hazard early-warning 4-pillar framework & impact-based forecasting: https://www.undrr.org/reports/global-status-mhews-2025
- Common Alerting Protocol (CAP) standard & cell broadcast: https://wmo.int/site/wmo-common-alerting-protocol , https://en.wikipedia.org/wiki/Common_Alerting_Protocol
- Humanitarian Data Exchange (HDX) data-sharing model (public/by-request/private, QA, API): https://data.humdata.org/about
- Ghana disease surveillance (IDSR / DHIMS2 / SORMAS): https://bmcpublichealth.biomedcentral.com/articles/10.1186/s12889-015-1397-y
- Ushahidi crowdsourced crisis reporting & verification: https://www.ushahidi.com/
