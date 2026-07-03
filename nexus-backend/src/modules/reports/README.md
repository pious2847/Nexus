# modules/reports

Citizen incident reporting (MASTER_PLAN Module C) — nationwide ground-truth data
with the decided trust model: **verification + reputation + corroboration**.

## Files
- `reports.trust.ts` — pure, tested trust math (initial confidence from reputation, corroboration confidence, reputation deltas).
- `reports.repository.ts` — SQL incl. PostGIS nearby-corroboration (`ST_DWithin`).
- `reports.service.ts` — submit / review / promote (all audited).
- `reports.routes.ts` — `/api/v1/incident-reports/*`.
- DDL: `src/db/migrations/0007_incident_reports.sql`.

## Flow
1. **Submit** (PWA/SMS/WhatsApp, optionally authenticated). District resolved from the point
   (PostGIS); confidence seeded from reporter **reputation**; nearby recent reports of the same
   hazard are **clustered** and their confidence raised (**corroboration**).
2. **Review** — an officer/moderator verifies or rejects (`report.verify`, geo-scoped). Verifying
   rewards the reporter's reputation; rejecting penalises it.
3. **Promote** — turn a report into a `hazard_event` (`hazard.event.create`, geo-scoped).

## Endpoints
- `POST /api/v1/incident-reports` — submit (optional auth)
- `GET  /api/v1/incident-reports` · `/:id` — list/detail (`report.read`)
- `POST /api/v1/incident-reports/:id/review` — verify/reject (`report.verify`)
- `POST /api/v1/incident-reports/:id/promote` — promote to hazard event (`hazard.event.create`)

## Setup
```bash
pnpm --filter nexus-backend db:migrate
```

## Notes / follow-ons
- Mounted at `/incident-reports` to avoid the legacy `/reports` (community reports) route.
- Corroboration window: 5 km / 24 h (tunable). Community-moderator pre-verification and
  SMS/WhatsApp intake wiring come with Module F + the citizen PWA.
- Light gamification (badges) can build on `reputation_score` later — no cash rewards (by design).
