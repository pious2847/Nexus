# nexus-backend

The N.E.X.U.S. API — Node/Express + PostgreSQL (Neon) + PostGIS, migrating to a
modular, TypeScript foundation (see [../docs/MASTER_PLAN.md](../docs/MASTER_PLAN.md),
[../docs/adr/](../docs/adr/README.md), [../CONTRIBUTING.md](../CONTRIBUTING.md)).

> The app runs under **tsx**, so TypeScript modules and the legacy CommonJS code
> run together during the incremental migration (Phase 0).

## Prerequisites
- Node 22 LTS+ and **pnpm** (`npm i -g pnpm`)
- A PostgreSQL database with PostGIS — use a **Neon branch** for dev/CI, never production.

## Setup
```bash
# from the repo root
pnpm install
pnpm --filter @nexus/shared build          # build shared types/constants (needed at runtime)

cd nexus-backend
cp .env.example .env                        # fill in DATABASE_URL (a Neon branch), JWT_SECRET, etc.
```

## Database
```bash
pnpm --filter nexus-backend db:migrate      # apply migrations (src/db/migrations)
pnpm --filter nexus-backend seed:geography  # 16 regions + 261 districts (PostGIS)
pnpm --filter nexus-backend seed:rbac       # roles/permissions + backfill legacy users
pnpm --filter nexus-backend backfill:place-id  # geo-tag sanitation rows from legacy district strings
```
Migrations are versioned (Drizzle journal); the old boot-time `schema.sql` is deprecated
(ADR-0003). Never edit an applied migration — add a new one.

## Run / test
```bash
pnpm --filter nexus-backend dev             # tsx watch (http://localhost:5000)
pnpm --filter nexus-backend typecheck
pnpm --filter nexus-backend test            # unit tests (DB-gated integration tests skip)

# run the DB-gated integration tests against a Neon branch:
RUN_DB_TESTS=1 DATABASE_URL=<branch> JWT_SECRET=test pnpm --filter nexus-backend test
```

## Structure
```
server.js                 legacy Express bootstrap (runs under tsx; mounts core routes)
src/
├── config/               db pool, constants
├── core/                 foundation modules (TypeScript)
│   ├── auth/  rbac/  geography/  audit/  notifications/  http/
├── modules/              feature modules (sanitation … ) — see CONTRIBUTING §3
├── controllers/ models/ routes/   legacy CommonJS (being migrated incrementally)
├── integrations/         external adapters (arkesel, …)
└── db/                   drizzle config + migrations
```

## API (implemented in the new core)
- `GET  /api/v1/health`
- `POST /api/v1/auth-v2/otp/request` · `/otp/verify` · `/refresh` · `/logout`
- `GET  /api/v1/geography/regions` · `/districts?region=` · `/resolve?q=` · `/district-for-point?lng=&lat=`

See [../docs/api/openapi.yaml](../docs/api/openapi.yaml). Legacy `/api/v1/*` sanitation
endpoints continue to work unchanged.
