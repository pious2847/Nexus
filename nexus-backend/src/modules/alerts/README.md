# modules/alerts

CAP-aligned alerts / dissemination (MASTER_PLAN Module F, spec 01 §11; ADR-0008).
Turns a hazard event into a public warning, published under **tiered authority**
and fanned out to subscribers via **in-app + SMS** (spec 02 N9 — guaranteed
reach, since in-app alone only reaches citizens with the app open). Push/WhatsApp/voice
layer on top of the same fan-out step.

## Files
- `alerts.cap.ts` — pure, tested: `requiredPublishPermission(severity)` (tiered authority)
  and `toCapJson()` (CAP 1.2-shaped payload).
- `alerts.sms.ts` — pure, tested: `formatAlertSms()` (single-segment, 160-char GSM-7 budget).
- `alerts.repository.ts` — SQL incl. subscriber lookup (ltree lineage overlap) and the
  SMS-eligible subset (`channels` contains `sms`, has a phone, not opted out).
- `alerts.service.ts` — `draftFromEvent`, `publish` (tiered RBAC + in-app + SMS fan-out), `toCap`.
  SMS sender is injectable (constructor param, defaults to `integrations/arkesel`) for testing.
- `alerts.routes.ts` — `/api/v1/warnings/*`.
- DDL: `src/db/migrations/0008_alerts.sql`, `0009_warnings_sms.sql` (`sms_attempted`/`sms_delivered`).

## Flow
1. **Draft** an alert from a hazard event (`POST /warnings/from-event`) — inherits
   category/severity/urgency/certainty/area; status `draft`.
2. **Publish** (`POST /warnings/:id/publish`) — the service checks the **severity-appropriate**
   permission (advisory/watch/severe/extreme) scoped to the area, then:
   - notifies every **in-app** subscriber whose place shares lineage with the affected area
     (`subscriptions` ⋈ `places` via ltree);
   - sends **SMS** to the subset who included `sms` in their channels, have a phone number, and
     haven't opted out (`notification_preferences`, absence = enabled). Counts are persisted
     (`sms_attempted`, `sms_delivered`) and returned in the publish response.

## Endpoints
- `GET  /api/v1/warnings` · `/:id` (includes CAP JSON + SMS delivery counts)
- `POST /api/v1/warnings/from-event` — draft (needs `alert.publish.advisory`)
- `POST /api/v1/warnings/:id/publish` — tiered by severity (`alert.publish.{advisory|watch|severe|extreme}`)

## Notes
- Mounted at `/warnings` to avoid the legacy `/alerts` (sensor/flood) route.
- Without `ARKESEL_API_KEY` set, SMS is **attempted but not delivered** (adapter dev-mode
  logs instead of sending) — `sms_delivered` stays 0. This is expected in dev/CI.
- Next: web-push + WhatsApp + voice channels, CAP geo-targeting by polygon, retry/ack tracking
  for guaranteed delivery, and an approval queue for auto-drafts.
