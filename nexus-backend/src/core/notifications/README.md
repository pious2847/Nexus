# core/notifications

Storage + read layer for notifications and alert routing (spec 03 §5). The
multi-channel **delivery** engine (push/SMS/WhatsApp/voice fan-out, CAP
geo-targeting, guaranteed/acknowledged delivery — spec 02 N9) is built in
**Module F** on top of these tables.

## Files
- `notifications.service.ts` — `NotificationsService`: in-app notifications, subscriptions, preferences, web-push registration.
- `notifications.repository.ts` — all SQL.
- DDL: `src/db/migrations/0004_audit_notifications.sql`.

## Tables
- `notifications` — in-app inbox.
- `subscriptions` — `(user, place, channels[], hazard_types[]?)` — who gets alerts for where (null hazard_types = all).
- `notification_preferences` — per-channel opt in/out.
- `push_subscriptions` — web-push (VAPID) endpoints.

## Usage
```ts
const svc = new NotificationsService(db);
await svc.notify({ userId, type: 'alert', title: 'Flood warning', body: '…' });
await svc.subscribe(userId, placeId, ['in_app', 'sms']);
await svc.setPreference(userId, 'push', true);
```

## Notes
Channels use the shared `NOTIFICATION_CHANNELS` constant. Delivery, rate-limiting, and
acknowledgement tracking are intentionally out of scope here — see Module F.
