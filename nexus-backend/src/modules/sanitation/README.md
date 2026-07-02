# modules/sanitation

The existing sanitation domain (units, toilets, gatherers, facilities, dumps,
sludge chain, schools MHM, health scores, flood assessments) — the platform's
original capability, now becoming one module among many (MASTER_PLAN Module E).

## Status (Phase 0 Step 0.7)
- ✅ **Geo-tagging:** all sanitation tables now carry `place_id` (migration `0005`),
  backfilled from the legacy `district` string via the geography resolver
  (`backfill-place-id.ts`). This kills the "Northern-only" `district` coupling for
  the sanitation data.
- ⏳ **Code move (follow-on, 0.7b):** the existing controllers/models/routes still
  live under `src/controllers|models|routes` (CommonJS) and run as before. Moving
  them into this module as TypeScript — and wiring the new core services
  (auth/RBAC/geography) into the HTTP layer — is a distinct, mechanical follow-on
  that requires the CJS→TS runtime bridge. It's deferred to avoid destabilising the
  running app mid-Phase-0.

## Backfill
```bash
# against a Neon BRANCH
pnpm --filter nexus-backend db:migrate            # adds place_id columns (0005)
pnpm --filter nexus-backend backfill:place-id     # resolve district string → place_id
```
The backfill is idempotent (only fills NULL place_id) and reports any district
strings it couldn't resolve for manual review.

## Notes
- `district` string is retained (dual-read) until place_id coverage is verified, then deprecated.
- Resolver logic + tests: `src/core/geography/geography.resolver.ts`.
