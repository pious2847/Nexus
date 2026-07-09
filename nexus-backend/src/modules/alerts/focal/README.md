# modules/alerts/focal

Community focal points (spec 02 N6, Module N — Tier 1 life-saving priority,
"last-mile community alerting beyond phones"). In rural Ghana the fastest
reliable channel is often the local FM station or a trusted person shouting
through town — not an app. Sirens/PA hardware and live radio-broadcast
automation have no integratable API (genuinely out of scope for a software
platform); what's buildable is a **registry of human/institutional relay
points** — community focal persons ("digital town-crier"), radio stations,
and physical notice boards — who receive a broadcast-ready script through
the same already-built SMS/email adapters, then relay it door-to-door,
on-air, or by gong-gong.

## Data model
`community_focal_points` (migration `0017_community_focal_points.sql`):
`place_id`, `name`, `relay_method` (`door_to_door|gong_gong|loudhailer|
radio_broadcast|notice_board`), `station_name` (for radio), `contact_phone`,
`contact_email`, `active`.

## Dissemination
`AlertsService.publish()` (`../alerts.service.ts`) fans out to every
**active** focal point covering the alert's area — not personal
subscribers gated by opt-in preference, since a focal point's whole job is
reaching people who have no phone/signal at all. Unlike the SMS/WhatsApp/
email subscriber formats (short, direct), focal points get
`formatAlertBroadcastScript()` (`../alerts.broadcast.ts`) — a longer,
read-aloud script that repeats the headline and explicitly asks the
recipient to relay it further. `warnings.focal_points_notified` tracks the
count, mirroring the other channel counters.

## Printable notice sheet
`GET /api/v1/warnings/:id/notice-sheet` (public, no auth, once an alert is
published — CAP scope is already `Public`) returns self-contained,
print-ready HTML (`formatNoticeSheetHtml()`) for posting on a physical
community notice board.

## Files
- `focal-point.repository.ts` / `focal-point.service.ts` / `focal-point.routes.ts`
  — the registry. Routes mounted at `/api/v1/community-focal-points`
  (`focal.create` / `focal.read` / `focal.manage`).
- `../alerts.broadcast.ts` — pure, tested: `formatAlertBroadcastScript()`,
  `formatNoticeSheetHtml()`.

## RBAC
`focal.create`/`focal.read` extend to `community_moderator` (they ARE the
focal-person concept N6 describes — registering others is part of their
role) and `field_worker` (read-only, so they know local relay contacts).
`focal.manage` (deactivate/edit) stays with officers+, same restriction
pattern as every other registry in this codebase.
