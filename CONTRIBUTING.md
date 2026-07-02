# Contributing to N.E.X.U.S.

> Read this before writing code. It exists so the codebase stays coherent as it grows and so
> a new developer can predict where anything lives. This is a **life-critical** system —
> reliability, clarity, and tests matter more than cleverness.

For the *what* and *why* of the product, see [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md).
For *technical decisions*, see [docs/adr/](docs/adr/README.md).

---

## 1. Tech stack (the short version)
| Concern | Choice | ADR |
|---------|--------|-----|
| Language | TypeScript (backend + frontend) | 0001 |
| Monorepo | pnpm workspaces | 0002 |
| DB / data layer | PostgreSQL (Neon) + PostGIS, Drizzle ORM + drizzle-kit migrations | 0003, 0007 |
| Validation / shared contracts | Zod (in `packages/shared`) | 0004 |
| Testing | Vitest + Supertest | 0005 |
| Background jobs | node-cron now → BullMQ + Redis for delivery | 0006 |
| API | Versioned REST `/api/v1`, standard envelope | 0009 |
| Realtime | Socket.IO | — |
| Frontend | Next.js 16 (App Router) + PWA via Serwist | — |
| Alerts | CAP-aligned | 0008 |

Baseline runtime: **Node 22 LTS+** (dev machines may run newer). Package manager: **pnpm**.

---

## 2. Repository layout
```
nexus/
├── docs/            # plan, ADRs, specs, research (source of truth for design)
├── packages/shared/ # TS types, Zod schemas, constants (hazard codes, roles, geo levels)
├── nexus-backend/   # Express API (modular — see §3)
├── nexus-frontend/  # Next.js web + PWA
└── nexus-ml/        # Python service (added later; not in the pnpm workspace)
```

## 3. Backend module convention (IMPORTANT)
Backend is organized by **feature module**, not by technical layer. A module is
self-contained and understandable in isolation.

```
nexus-backend/src/
├── core/        # foundation: auth, rbac, geography, users, notifications, audit
├── modules/<name>/
│   ├── <name>.routes.ts       # Express routes → controller
│   ├── <name>.controller.ts   # HTTP in/out only; no business logic
│   ├── <name>.service.ts      # business logic; the only place with rules
│   ├── <name>.repository.ts   # DB access (Drizzle); the only place with SQL
│   ├── <name>.schema.ts       # Drizzle table definitions for this module
│   ├── <name>.validators.ts   # Zod schemas (import shared where cross-cutting)
│   ├── <name>.types.ts        # module-internal types
│   ├── <name>.test.ts         # Vitest tests
│   └── README.md              # what this module does, endpoints, data
├── shared/      # middleware, errors, utils, base helpers
├── integrations/# external adapters (openMeteo, glofas, firms, arkesel, whatsapp, cloudinary)
├── jobs/        # scheduled/queued workers
└── db/          # drizzle config, migrations, seeders
```

**Layering rule (enforced by review):**
`routes → controller → service → repository → db`. Controllers never touch the DB; services
never build HTTP responses; only repositories contain SQL. This keeps logic testable and
swappable (e.g. rule-based → ML prediction behind a service interface).

### Adding a new module
1. Create `modules/<name>/` with the files above.
2. Define tables in `<name>.schema.ts`; run `pnpm db:generate` to create a migration.
3. Mount routes in the module index.
4. Write a `README.md` and at least one test.

### Adding a new hazard type
Do **not** write new engine code. Insert a `hazard_type` config row and (if needed) register
an evaluator strategy. See [docs/specs/01-multi-hazard-ews.md](docs/specs/01-multi-hazard-ews.md).

## 4. Frontend convention
- Routes under `src/app/` grouped by audience: `(public)`, `(auth)`, `(citizen)`,
  `(dashboard)`, `(admin)`.
- Feature code (hooks, components, api-clients) under `src/features/<name>/`, mirroring
  backend modules.
- Shared UI in `src/components/`; api client, query client, auth, i18n, offline-sync in
  `src/lib/`.
- Data fetching via TanStack Query; forms via react-hook-form + Zod resolver (schemas from
  `packages/shared`).

## 5. Coding standards
- **Comment the *why*, not the *what*.** Non-obvious logic (thresholds, geo math, delivery
  fallbacks) must explain intent. Public functions get JSDoc/TSDoc.
- **Everything is geo-tagged and time-stamped.** New domain tables reference `place_id` and
  carry `created_at`/`updated_at`. Records that feed data/predictions also carry `source` and
  a verification/confidence flag where relevant.
- **No hard-coded "Northern"/district strings.** Use the geography service and `place_id`.
- **Validate all input** with Zod at the edge. Never trust client data.
- **Fail safe.** For anything on the alert/warning path, prefer degraded delivery over
  silent failure (see ADR-0006, spec 02 N8/N9).
- **Standard API envelope** (ADR-0009). Throw typed `AppError`; let the central handler format.
- **Privacy:** never expose citizen PII in public/data-hub responses; anonymize/aggregate
  (H3) for open data.

## 6. Git & PR workflow
- Branch from `master`: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
- A PR must: pass `pnpm typecheck` + `pnpm test`, update/add a module `README.md` when
  behavior changes, and include tests for critical-path logic.
- Never commit secrets. `.env` stays local; document new vars in `.env.example`.

## 7. Definition of Done (per feature)
- [ ] Types + Zod validation in place
- [ ] Service logic unit-tested; critical API paths integration-tested
- [ ] Geo-scoped + permission-checked (if user-facing)
- [ ] Comments on non-obvious logic; module README updated
- [ ] No regressions to existing endpoints
- [ ] Migration committed (if schema changed) — never edit an applied migration
