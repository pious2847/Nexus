# Spec 04 — Migration Plan & Phase 0 Definition of Done

> How we get from today's working app to the modular, nationwide foundation **without
> breaking what exists**. This is the concrete first coding milestone.
>
> Parent: [MASTER_PLAN.md](../MASTER_PLAN.md) · Depends on [spec 03](03-foundation-data-model.md),
> [ADRs](../adr/README.md). **Date:** 2026-07-02.

---

## 1. Starting point (verified 2026-07-02)
- Backend: CommonJS, Express 5, raw `pg`, 26 controllers / 20 models / 28 routes, ~8k LOC,
  **all 97 files parse cleanly**. `schema.sql` (605 lines) is executed on every boot.
- `district` is a **free-text string** on domain tables — the core thing to normalize.
- Frontend: Next.js 16 + TypeScript, ~15 dashboard pages, TanStack Query, Leaflet.
- Tooling: **pnpm 11.5.2**, **Node 24** on dev (target Node 22 LTS+). No tests. Both `.env`
  files present. `node_modules` not installed.

## 2. Strategy: strangler pattern, not big-bang
We build the new modular structure **alongside** the old, move features **one module at a
time**, and keep the server booting and endpoints stable throughout. Each step is a
reviewable PR that leaves the app working.

**Golden rules**
- The app boots and existing endpoints behave identically after every step.
- No applied migration is ever edited (append new ones).
- Convert a file to TypeScript **when it moves** into a module (ADR-0001) — no separate rewrite.
- `district` string is kept and dual-written until backfill to `place_id` is proven, then deprecated.

---

## 3. Phase 0 — step by step

### Step 0.1 — Monorepo & tooling scaffold
- Convert repo to **pnpm workspaces**: `nexus-backend`, `nexus-frontend`, `packages/shared`.
- Add backend **TypeScript** config (`allowJs: true` so JS and TS coexist during migration),
  build step, `tsx`/`ts-node` for dev.
- Add **Vitest** + **Supertest**, root `typecheck`/`test`/`build` scripts, and CI (typecheck + test).
- Create `.env.example` for both apps. **No behavior change.**

### Step 0.2 — Introduce Drizzle + migrations (replace boot-time DDL)
- Add **Drizzle + drizzle-kit**; enable **PostGIS** + **ltree** on Neon.
- Import the current `schema.sql` as the **baseline migration** (so existing tables are
  represented) and **stop running `schema.sql` on boot** (`initDb` becomes a migration run).
- Verify: fresh DB migrates to today's schema; existing DB is unaffected.

### Step 0.3 — Geography foundation (`places`)
- Add `places` table (spec 03 §1) + seed **16 regions + 261 districts** from verified
  geoBoundaries/data.gov.gh (boundary + 2021 population where available).
- Build the **geography service** (lookups, subtree, point-in-district, nearest).
- Add a **district-string → place_id resolver** used by later backfill.

### Step 0.4 — Identity, RBAC & orgs
- Add `organizations`, `roles`, `permissions`, `role_permissions`, `user_roles` (scoped),
  and extend `users` (phone, reputation, language, status) per spec 03.
- Migrate existing users into the new role model (map current `role` string → `user_roles`
  with national/appropriate scope).
- Implement `can(user, permission, placeId)` + middleware; **unit-test it** (critical path).
- Keep existing `authenticate`/`requireRole` working via a compatibility shim during transition.

### Step 0.5 — Auth additions
- Add **phone OTP login** (Arkesel SMS) + `refresh_tokens` + `otp_codes`; keep email/password.
- Add `account_verifications` flow (officials/NGOs/researchers pending → approved).

### Step 0.6 — Audit + notifications skeleton
- Add `audit_logs` + a write helper; wire it into auth and (later) sensitive actions.
- Add `notifications`, `subscriptions`, `notification_preferences`, `push_subscriptions`
  tables (delivery engine itself comes with Module F).

### Step 0.7 — Move sanitation into a module (prove the pattern)
- Reorganize the existing sanitation-related controllers/models/routes into
  `modules/sanitation/` following the module convention (converting to TS as they move).
- Add `place_id` to sanitation tables; **backfill from `district` string** via the resolver;
  dual-read (prefer `place_id`, fall back to string) until verified.
- Regression check: every existing sanitation endpoint returns the same shape/behavior.

### Step 0.8 — Core foldout & cleanup
- Move auth/rbac/geography/users/notifications/audit into `core/`.
- Document each module with a `README.md`; ensure `docs/` links resolve.
- Turn on lint + typecheck gates in CI.

> Modules beyond sanitation (hazards, reports, health, alerts, datahub, response, …) are
> **separate later milestones** — each specced right before it's built. Phase 0 only proves
> the foundation + one migrated module.

---

## 4. Phase 0 — Definition of Done   (status 2026-07-02)
- [x] pnpm workspaces; backend builds as TypeScript (JS/TS coexist); FE unchanged.
- [x] Drizzle migrations replace boot-time `schema.sql`; fresh + existing DBs both work.
- [x] PostGIS + ltree enabled on Neon (also pgrouting + h3 confirmed).
- [x] `places` seeded with **16 regions + 261 districts** (count verified), with boundaries + region population.
- [x] Geography service (subtree, point-in-district, nearest) with tests.
- [x] RBAC: roles/permissions/scoped `user_roles`; `can()` unit-tested; legacy auth still works.
- [x] Phone OTP login (Arkesel) alongside email/password; refresh tokens; account verification.
- [x] Audit logging on auth events; notifications skeleton.
- [~] Sanitation **geo-tagged** (`place_id` backfilled, 530 rows) + endpoints regression-verified.
      *Follow-on (0.7b remainder): move legacy controllers into `modules/sanitation` as TS.*
- [x] CI: typecheck + tests; core/module READMEs; `.env.example` documented. *(ESLint = follow-on.)*
- [x] "Run locally" guide in the backend README.
- [x] **Bonus:** CJS→TS runtime bridge — new auth-v2 + geography routers live over HTTP (0.7b).

**Test status:** typecheck 0 errors; 25+ tests green (unit + DB-gated integration on a Neon branch);
app boots under tsx and serves both new + legacy endpoints.

**Explicit non-goals for Phase 0:** no new hazards, no alerts delivery engine, no Data Hub,
no PWA offline work, no Module N features. Those are subsequent milestones.

---

## 5. Risks & mitigations
| Risk | Mitigation |
|------|------------|
| Backfill mismaps district strings to wrong place | Resolver with fuzzy match + manual review report; dual-read until verified; keep old column |
| Boot-time DDL removal breaks deploys | Baseline migration reproduces exact current schema; test on a Neon branch first |
| TS migration stalls the team | `allowJs` lets JS/TS coexist; convert only on move; no big-bang |
| PostGIS/ltree not enabled | One-time `CREATE EXTENSION`; verified in Step 0.2/0.3 (confirmed available on Neon) |
| Geography data is wrong vintage (170/216) | Assert 16/261 counts in a seed test before proceeding |
| Working against live Neon DB | Use a **Neon branch** (or ephemeral PostGIS container) for dev/CI, not production |

---

## 6. Prerequisites to start Phase 0 (the green-light checklist)
1. ✅ Decisions locked (ADRs 0001–0009).
2. ✅ Foundation schema designed (spec 03).
3. 🟢 **Geography dataset acquired & verified** — done and committed to
   [`data/geography/`](../../data/geography/README.md): 16 regions (capital + 2021
   population) + 260 districts mapped to regions (spatial-join validated). **Two small
   follow-ups remain:** add the 261st district (**Guan, Oti Region**) geometry, and join
   **district-level** 2021 population (GSS Vol 3A). Neither blocks starting Phase 0.
4. ✅ **Dev database ready** — Neon dev branch provided and verified (2026-07-02):
   **PostgreSQL 17.10**; extensions all present & enabled: **PostGIS 3.5.0**, **ltree 1.3**,
   **pgcrypto**, **pgrouting 3.6.2**, **h3 4.1.3**, postgis_topology. Live geo query
   validated (Accra→Tamale 426 km); `gen_random_uuid()` works. This confirms ADR-0003/0007
   on the real instance. (Use a Neon branch for CI too; don't run migrations on prod.)
5. ✅ **Existing app boots against the dev DB** — verified: `pnpm install` clean, schema
   initialized on Neon, all crons scheduled, server RUNNING, `/api/v1/health` returns
   `operational`. Confirmed the Northern-only limitation live (weather cron ran for only
   **10 districts**).
6. ✅ **Module N adopted**; Tier-1 features slotted into the roadmap (spec 02, MASTER_PLAN Phase 1–2).

**All green-light gates are now cleared.** Remaining before/at Phase 0 start (non-blocking):
add Guan District (261st) geometry + join district-level population; rotate the shared dev
credential when convenient. **We are ready to begin Phase 0 (Step 0.1).**
