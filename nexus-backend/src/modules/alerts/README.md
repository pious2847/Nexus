# modules/alerts

CAP-aligned alerts / dissemination (MASTER_PLAN Module F, spec 01 §11; ADR-0008).
Turns a hazard event into a public warning, published under **tiered authority**
and fanned out to subscribers. First slice delivers **in-app notifications**;
SMS/push/WhatsApp/voice + geo-targeting layer on top of the same fan-out step.

## Files
- `alerts.cap.ts` — pure, tested: `requiredPublishPermission(severity)` (tiered authority)
  and `toCapJson()` (CAP 1.2-shaped payload).
- `alerts.repository.ts` — SQL incl. subscriber lookup (ltree lineage overlap).
- `alerts.service.ts` — `draftFromEvent`, `publish` (tiered RBAC + notification fan-out), `toCap`.
- `alerts.routes.ts` — `/api/v1/warnings/*`.
- DDL: `src/db/migrations/0008_alerts.sql`.

## Flow
1. **Draft** an alert from a hazard event (`POST /warnings/from-event`) — inherits
   category/severity/urgency/certainty/area; status `draft`.
2. **Publish** (`POST /warnings/:id/publish`) — the service checks the **severity-appropriate**
   permission (advisory/watch/severe/extreme) scoped to the area, then notifies every subscriber
   whose place shares lineage with the affected area (`subscriptions` ⋈ `places` via ltree).

## Endpoints
- `GET  /api/v1/warnings` · `/:id` (includes CAP JSON)
- `POST /api/v1/warnings/from-event` — draft (needs `alert.publish.advisory`)
- `POST /api/v1/warnings/:id/publish` — tiered by severity (`alert.publish.{advisory|watch|severe|extreme}`)

## Notes
- Mounted at `/warnings` to avoid the legacy `/alerts` (sensor/flood) route.
- Next: multi-channel delivery (Arkesel SMS/voice, web-push, WhatsApp), CAP geo-targeting by
  polygon, delivery/acknowledgement tracking (spec 02 N9), and an approval queue for auto-drafts.
