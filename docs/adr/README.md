# Architecture Decision Records (ADRs)

Short, dated records of significant technical decisions and *why* we made them, so future
developers (and future us) understand the reasoning, not just the result.

Format per ADR: **Status · Context · Decision · Consequences**. Statuses: `Accepted`,
`Superseded by ADR-XXXX`, `Proposed`.

All decisions below were made during the v2.0 planning phase and reflect the constraints in
[../MASTER_PLAN.md](../MASTER_PLAN.md): nationwide scale, life-critical reliability,
long-term maintainability, and hand-over readiness (government/NGO).

---

## ADR-0001 — TypeScript end-to-end
**Status:** Accepted (2026-07-02)

**Context:** Backend is currently plain JavaScript (CommonJS, ~8k LOC, 97 files, all parsing
cleanly). Frontend is already TypeScript. The system is life-critical and must be
maintainable by developers we haven't met yet (incl. eventual government IT).

**Decision:** Adopt **TypeScript across backend and frontend**. New backend code is
TS-only. Existing backend files are converted to TS **as they are moved into feature
modules** during the restructure (not in a separate big-bang rewrite). Shared types live in
a `packages/shared` workspace.

**Consequences:** Compile-time safety on the alert/prediction paths where bugs cost lives;
shared request/response types between FE and BE; a one-time conversion cost paid
incrementally during the module migration; `tsconfig` + build step added to backend.

---

## ADR-0002 — pnpm workspaces monorepo
**Status:** Accepted (2026-07-02)

**Context:** Repo already uses **pnpm** (v11.5.2; git history shows pnpm build config). We
are moving to a modular monorepo with backend, frontend, a future Python service, and
shared packages.

**Decision:** Use **pnpm workspaces**. Top-level packages: `nexus-backend`,
`nexus-frontend`, `packages/shared` (TS types, Zod schemas, constants: hazard codes, role
codes, geo levels), and later `nexus-ml` (Python, managed separately). Root scripts
orchestrate typecheck/test/build across workspaces.

**Consequences:** One install, shared code without publishing, consistent tooling. The
Python service stays outside the JS workspace but inside the repo.

---

## ADR-0003 — Drizzle ORM + drizzle-kit, with raw-SQL escape hatch; PostGIS on Neon
**Status:** Accepted (2026-07-02)

**Context:** Current data layer is raw `pg` with class-based models writing SQL by hand, and
`schema.sql` executed on every boot (605 lines) — no versioned migrations. We need
type-safety, real migrations, and heavy **PostGIS** use (risk zones, impact intersection,
routing). Research: Prisma has weak PostGIS; Kysely is a great query builder but
bring-your-own-migrations; **Drizzle** is TS-first, 5KB, has documented PostGIS geometry
support, generates migrations from schema diffs, and allows raw SQL.

**Decision:** Use **Drizzle ORM** as schema-as-code + type-safe queries, **drizzle-kit** for
migrations. Use Drizzle's `sql`/`db.execute()` **raw-SQL escape hatch** for complex PostGIS
(polygon intersection, `ST_*`, H3) and heavy analytics queries. Enable PostGIS on Neon;
adopt **H3** for map aggregation/location anonymization and **pgrouting** for evacuation/
dispatch routing (all confirmed available on Neon).

**Consequences:** Schema is the single source of truth; migrations are versioned and
reviewable; boot no longer runs DDL. Existing hand-written SQL migrates to Drizzle
incrementally (raw SQL still allowed, so no loss of control). Slight learning curve for
Drizzle's query API.

---

## ADR-0004 — Validation & shared contracts with Zod
**Status:** Accepted (2026-07-02)

**Context:** Backend uses `express-validator` inconsistently. We want one validation story
and shared request/response contracts between FE and BE.

**Decision:** Use **Zod** as the single validation + schema library. Define input schemas in
`packages/shared` where they are reused by the frontend (forms) and backend (request
validation). A small middleware validates `body`/`query`/`params` against a Zod schema.
`express-validator` is phased out as endpoints move into modules.

**Consequences:** One source of truth for shapes; types inferred from schemas (no drift);
runtime + compile-time safety. Migration is gradual.

---

## ADR-0005 — Testing with Vitest + Supertest
**Status:** Accepted (2026-07-02)

**Context:** Backend currently has **no tests** (`"No tests yet"`). For a life-critical
system, the prediction, alerting, and delivery paths must be tested.

**Decision:** Use **Vitest** (fast, TS-native, shared config with the frontend) + **Supertest**
for API/integration tests. Priority coverage: RBAC/geo-scope, hazard evaluators, alert
approval + delivery, and geography resolution. Target meaningful coverage on critical paths,
not a blanket %. CI runs typecheck + tests on every PR.

**Consequences:** Confidence to refactor; regressions caught before deploy. Test DB strategy
needed (ephemeral Postgres/PostGIS container or a Neon branch per CI run).

---

## ADR-0006 — Jobs & delivery reliability: node-cron now, BullMQ+Redis later
**Status:** Accepted (2026-07-02)

**Context:** Scheduled work uses `node-cron` in-process. Life-safety requires **guaranteed,
retryable alert delivery** and durable background jobs (spec 02 N8/N9). In-process cron
loses jobs on crash/restart and can't retry reliably.

**Decision:** Keep **node-cron** for simple periodic tasks in early phases. Introduce
**BullMQ + Redis** for the **alert-delivery pipeline and critical ingestion** when we build
Module F/N — giving retries, acknowledgment tracking, dead-letter queues, and horizontal
workers. Abstract job scheduling behind an interface so the swap is contained.

**Consequences:** Reliable delivery + retries for life-critical messages; adds Redis as
infra when we reach alerting. Early phases stay lightweight.

---

## ADR-0007 — Normalized national geography (replace the `district` string)
**Status:** Accepted (2026-07-02)

**Context:** Today `district` is a free-text string column on domain tables (e.g.
`sanitation_units.district`) — the root of the "Northern-only" limitation and impossible to
scope/aggregate reliably nationwide.

**Decision:** Introduce a canonical **`places`** tree (country → region → district →
constituency → community) as a single self-referential table with PostGIS geometry, and
have every domain record reference a `place_id`. Seed **16 regions + 261 MMDAs** from
authoritative data (geoBoundaries/data.gov.gh), verified to the **current** count (not the
old 170/216 vintages). Existing string districts are mapped to `place_id` during migration.

**Consequences:** Reliable geographic scoping (RBAC), aggregation, and geo-targeted alerts;
impact-based forecasting becomes possible. One-time data-prep + backfill migration. See
[../specs/03-foundation-data-model.md](../specs/03-foundation-data-model.md).

---

## ADR-0008 — CAP-aligned alerting standard
**Status:** Accepted (2026-07-02)

**Context:** We need interoperable, geo-targeted, multi-channel warnings. Research: GMet is
rolling out a **CAP**-based national alerting system (2026) coordinating with NADMO/others.

**Decision:** Model all alerts on the **Common Alerting Protocol (CAP)** (event, category,
severity, urgency, certainty, area polygon/geocode, instructions). Pursue interoperability
with GMet's CAP feed as an authoritative source.

**Consequences:** National + international interoperability; future cell-broadcast readiness;
a concrete partnership path with GMet/NADMO. Slightly more structured alert model up front.

---

## ADR-0009 — API style: versioned REST + standard response envelope
**Status:** Accepted (2026-07-02)

**Context:** Existing API is REST under `/api/v1` with a consistent
`{ success, data|message, count? }` envelope and a central error handler.

**Decision:** Keep **versioned REST** (`/api/v1`) and the **standard envelope**. Formalize:
success `{ success: true, data, meta? }`, error `{ success: false, error: { code, message, details? } }`.
Central error handler maps typed `AppError`s to responses. Document with OpenAPI. Public Data
Hub API (Module G) gets its own key-authenticated surface later.

**Consequences:** Predictable contracts for FE and third parties; minimal disruption
(builds on what exists).
