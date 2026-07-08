# modules/safety

"I'm Safe" check-in (spec 02 N1, Module N — Tier 1 life-saving priority).
After a hazard event, people mark themselves **Safe / Need Help / Injured**
so responders instantly see who's unaccounted for instead of searching
blindly. The primary intake channel is SMS — no smartphone or app required —
with HTTP routes available for a future PWA tap.

## Data model
`safety_checkins` (migration `0015_safety_checkins.sql`): `hazard_event_id`
(auto-resolved, nullable), `place_id`, `status` (`safe|need_help|injured`),
`subject_name` (set when a focal person checks in someone else),
`reporter_phone`, `reported_by`, `source` (`sms|pwa|community_moderator`).

Deliberately **no verification/trust workflow** (unlike incident reports) —
a false "I'm safe" is far less dangerous than a missed one, so nothing here
gatekeeps a check-in from being recorded.

## Event auto-linking
A check-in doesn't require the sender to know a hazard event ID (far too
technical for SMS). `checkin.repository.ts`'s `findActiveEventForPlace()`
finds the most recent **non-closed** hazard event whose affected place is an
ancestor of (or the same as) the check-in's place, via the `places` ltree
`path`. If no open event covers the place, the check-in is still recorded
(`hazard_event_id` null) — never reject a check-in for lack of context.

## SMS grammar
```
SAFE, <place>            e.g. SAFE, Tolon
HELP, <place>             -> need_help
INJURED, <place>          -> injured
SAFE, <place>, <name>     -> a focal person checking someone else in (N6's "last-mile human network")
```
Comma-delimited (like `modules/reports/sms`), for the same reason: Ghanaian
place names are often multi-word. Routed through the **shared** inbound SMS
webhook (`modules/reports/sms/report-sms.routes.ts`'s `/api/v1/sms-intake/inbound`)
via `isCheckinCommand()` — a real SMS provider posts every message to one URL
regardless of content, so keyword-based dispatch happens there, not via a
second webhook endpoint.

## Files
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

## RBAC
`safety.checkin.create` is broad (citizen, field_worker, community_moderator,
officers+) — checking in should never be gatekept. `safety.checkin.read`
(the aggregated "who's safe" dashboard) is officer/moderator-level, geo-scoped
like every other module here (no "everyone nationally" endpoint).
