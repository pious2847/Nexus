# core/notifications

Storage + read layer for notifications and alert routing (spec 03 §5). The
multi-channel **delivery** engine (push/SMS/WhatsApp/voice fan-out, CAP
geo-targeting, guaranteed/acknowledged delivery — spec 02 N9) is built in
**Module F** on top of these tables.

## Files
- `notifications.service.ts` — `NotificationsService`: in-app notifications, subscriptions, preferences, web-push registration.
- `notifications.repository.ts` — all SQL.
- `notifications.routes.ts` — `/api/v1/notifications/*`, the citizen-facing HTTP surface (all routes act on the caller's own data).
- DDL: `src/db/migrations/0004_audit_notifications.sql`.

## Tables
- `notifications` — in-app inbox.
- `subscriptions` — `(user, place, channels[], hazard_types[]?)` — who gets alerts for where (null hazard_types = all).
- `notification_preferences` — per-channel opt in/out.
- `push_subscriptions` — web-push (VAPID) endpoints.

## Endpoints (all require auth; act on the caller's own data)
- `GET  /api/v1/notifications` — my inbox (`?unread=true` filter)
- `POST /api/v1/notifications/:id/read` — mark one read
- `GET/POST /api/v1/notifications/subscriptions` — list / add a place subscription
- `DELETE /api/v1/notifications/subscriptions/:placeId` — unsubscribe
- `GET/PUT /api/v1/notifications/preferences` — per-channel opt in/out
- `POST/DELETE /api/v1/notifications/push` — web-push endpoint registration

## Usage
```ts
const svc = new NotificationsService(db);
await svc.notify({ userId, type: 'alert', title: 'Flood warning', body: '…' });
await svc.subscribe(userId, placeId, ['in_app', 'sms']);
await svc.setPreference(userId, 'push', true);
```

## How this closes the loop with Module F
`AlertsService.publish()` (modules/alerts) looks up subscribers via `subscriptions ⋈ places`
(ltree lineage — ancestor **or** descendant of the warning's area) and calls `notify()` for
each, so subscribing to a district also surfaces warnings issued at the parent region (and
vice versa). Verified end-to-end in `notifications.integration.subscription.test.ts`.

## Notes
Channels use the shared `NOTIFICATION_CHANNELS` constant. Multi-channel delivery
(SMS/WhatsApp/voice fan-out, CAP geo-targeting, guaranteed/acknowledged delivery — spec 02
N9), rate-limiting, and push payload delivery are intentionally out of scope here — the
in-app channel is live; other channels build on the same `notify()` call in Module F.
