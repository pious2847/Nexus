# modules/safety

Two spec 02 (Module N) life-safety features: **"I'm Safe" check-in (N1,
Tier 1)** and **SOS / panic button (N2, Tier 2)**. Both use SMS as the
primary intake channel — no smartphone or app required — with HTTP routes
available for a future PWA.

## N1 — "I'm Safe" check-in

After a hazard event, people mark themselves **Safe / Need Help / Injured**
so responders instantly see who's unaccounted for instead of searching
blindly.

### Data model
`safety_checkins` (migration `0015_safety_checkins.sql`): `hazard_event_id`
(auto-resolved, nullable), `place_id`, `status` (`safe|need_help|injured`),
`subject_name` (set when a focal person checks in someone else),
`reporter_phone`, `reported_by`, `source` (`sms|pwa|community_moderator`).

Deliberately **no verification/trust workflow** (unlike incident reports) —
a false "I'm safe" is far less dangerous than a missed one, so nothing here
gatekeeps a check-in from being recorded.

### Event auto-linking
A check-in doesn't require the sender to know a hazard event ID (far too
technical for SMS). `checkin.repository.ts`'s `findActiveEventForPlace()`
finds the most recent **non-closed** hazard event whose affected place is an
ancestor of (or the same as) the check-in's place, via the `places` ltree
`path`. If no open event covers the place, the check-in is still recorded
(`hazard_event_id` null) — never reject a check-in for lack of context.

### SMS grammar
```
SAFE, <place>            e.g. SAFE, Tolon
HELP, <place>             -> need_help
INJURED, <place>          -> injured
SAFE, <place>, <name>     -> a focal person checking someone else in (N6's "last-mile human network")
```
Comma-delimited (like `modules/reports/sms`), for the same reason: Ghanaian
place names are often multi-word.

### Files
- `checkin.repository.ts` / `checkin.service.ts` / `checkin.routes.ts` — the
  core module: record a check-in, list/summarize by hazard event or geo
  scope. Routes mounted at `/api/v1/safety-checkins` (authenticated —
  `safety.checkin.create` / `safety.checkin.read`).
- `sms/checkin-sms.parser.ts` — pure, tested grammar parser.
- `sms/checkin-sms.service.ts` — `handleInboundSmsCheckin()`: parse -> resolve
  place (fuzzy-matched via `GeographyService.resolveDistrict`) -> record ->
  confirmation SMS. Unlike incident reports, **an unresolvable place is NOT
  recorded** — there's nothing useful to aggregate a place-less check-in
  into, so the sender is asked to retry instead.

### RBAC
`safety.checkin.create` is broad (citizen, field_worker, community_moderator,
officers+) — checking in should never be gatekept. `safety.checkin.read`
(the aggregated "who's safe" dashboard) is officer/moderator-level, geo-scoped
like every other module here (no "everyone nationally" endpoint).

## N2 — SOS / panic button

A citizen in immediate danger sends an SOS with location, creating a
high-priority alert. **Module M (formal dispatch tasking) doesn't exist
yet**, so this v1 achieves the spec's "minutes matter" goal via **immediate
SMS + in-app notification of every responder** whose role/geo-scope covers
the affected place, rather than a dispatch board.

### Data model
`sos_alerts` (migration `0016_sos_alerts.sql`): `place_id` (reverse-geocoded),
`geometry` (`Point`, **NOT NULL** — an SOS with no location has nothing
useful to record), `location_precision` (`gps` — a future PWA reading
`navigator.geolocation` — or `district_centroid` — the SMS fallback, since
raw SMS can't carry live GPS), `status`
(`open|acknowledged|resolved|false_alarm`), `danger_type`, `notes`,
`reporter_phone`, `responders_notified` (a real count — see below).

### Responder fan-out
`sos.repository.ts`'s `findResponderCandidates()` finds every `user_roles`
grant that is national (`place_id IS NULL`) or whose scope is an ancestor of
the SOS's place (ltree `<@`); `sos.service.ts` then filters to roles holding
`sos.manage` (via the pure `roleHasPermission()` — no extra query) and
immediately SMS + in-app notifies each one with a Google Maps link to the
exact coordinates. This is a **real, live-verified fan-out** — not a stub —
confirmed against the actual live DB with a seeded geo-scoped officer.

### SMS grammar
```
SOS, <place>, <what is happening>   e.g. SOS, Tolon, Trapped by flood water
```
Unlike the N1 check-in grammar, **the place is mandatory** (no bare `SOS`) —
the schema requires a geometry, and there's no honest location to fall back
to over SMS.

### Files
- `sos.repository.ts` / `sos.service.ts` / `sos.routes.ts` — mounted at
  `/api/v1/sos`. `POST /` is the "big red button" (for a future PWA posting
  live GPS); `GET /?scope=` / `GET /:id` / `POST /:id/acknowledge` /
  `POST /:id/resolve` are the officer/moderator view (`sos.read` /
  `sos.manage`).
- `sms/sos-sms.parser.ts` — pure, tested grammar parser.
- `sms/sos-sms.service.ts` — `handleInboundSmsSos()`: parse -> resolve place
  -> resolve its centroid (no live GPS over SMS) -> raise (which itself fans
  out to responders) -> confirmation SMS.

### RBAC
`sos.create` is granted down to `citizen` (sending an SOS must never be
gatekept) with a **national-scoped** grant — new citizens get `place_id
NULL` at signup (`auth.repository.ts`), so the create route's permission
check doesn't need to know the place in advance (it isn't known until after
reverse-geocoding). `sos.read`/`sos.manage` are officer/moderator+, geo-scoped
like every other module here.

## Shared SMS dispatch
Both N1 and N2 (and citizen incident reports, `modules/reports/sms`) are
routed through the **same shared inbound SMS webhook**
(`modules/reports/sms/report-sms.routes.ts`'s `/api/v1/sms-intake/inbound`)
via keyword-sniffing (`isSosCommand()` checked first, then
`isCheckinCommand()`, then falling through to report parsing) — a real SMS
provider posts every inbound message to one configured URL regardless of
content, so there's no second/third webhook endpoint.
