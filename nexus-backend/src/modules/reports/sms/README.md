# modules/reports/sms

Citizen incident reporting via SMS (Phase 1 gap — "citizen reporting via PWA /
SMS / WhatsApp", MASTER_PLAN §11). Reuses the existing `ReportsService`
(Module C) and `GeographyService.resolveDistrict()` (the fuzzy district
resolver built for the sanitation `place_id` backfill) — almost no new
plumbing was needed, just the SMS-specific parsing/orchestration layer.

## ⚠️ Honesty note on the Arkesel webhook shape
Arkesel's exact inbound-SMS webhook payload is **not publicly documented** as
of this writing — their two-way messaging product is "KOVA IQ", a separate
unified inbox, not a plainly-documented webhook on the core SMS API.
`integrations/arkeselInbound.ts`'s `normalizeArkeselInboundPayload()`
defensively accepts several common field-name aliases (`from`/`sender`/
`msisdn`/`phone`, `text`/`message`/`sms`/`body`) so it has the best realistic
chance of working, but **this has not been confirmed against a live Arkesel
payload**. When a dedicated/short-code inbound number is provisioned, capture
one real payload and update that one function — nothing else needs to change.
The endpoint also accepts an already-normalized `{ from, text }` body
directly, so it's fully testable and usable today regardless of that gap.

## Grammar
```
REPORT <type>, <district or community>, <description>
e.g. REPORT FLOOD, TOLON, Water rising near the market
Types: FLOOD, RAIN, FIRE, DROUGHT, DISEASE, TOILET, OTHER (case-insensitive; OTHER/unrecognized -> hazardType null)
```
A delimiter (comma) is required rather than free-text space-splitting, because
many Ghanaian district names are multi-word ("Tamale Metropolitan", "Nanumba
North") and unambiguous SMS parsing needs a separator.

## Files
- `report-sms.parser.ts` — pure, tested: `parseSmsReportCommand()`, hazard-word
  aliases, `buildHelpText()`/`buildConfirmationText()`.
- `report-sms.service.ts` — `handleInboundSmsReport()`: parse → resolve district
  (fuzzy-matched, so "Sagnarigu" still finds "Sagnerigu") → submit via
  `ReportsService` (`source: 'sms'`, anonymous reporter, phone recorded) → send
  a confirmation SMS. Decoupled from Express — takes `{ from, text }` and
  injected deps, so it's testable without an HTTP layer. **If the place can't
  be resolved, the report is still submitted** (never lose a citizen report
  over a typo) — the reply just says an officer will follow up.
- `report-sms.routes.ts` — `/api/v1/sms-intake/inbound` (public webhook, no
  user auth). Optional shared-secret guard via `SMS_INBOUND_TOKEN` (`?token=`
  query param) — **must be set before pointing a real provider at this in
  production**; open in dev if unset. **This is now the single dispatch point
  for all inbound SMS** — it also routes `SAFE`/`HELP`/`INJURED` messages to
  the "I'm Safe" check-in handler (`modules/safety/sms`, spec 02 N1) via
  `isCheckinCommand()`, since a real provider posts every message to one URL
  regardless of content. Known ambiguity: a bare `"HELP"` (no place) is
  classified as a check-in attempt and gets the check-in help text, not the
  report help text — an acceptable v1 trade-off, noted here rather than
  silently left for someone to rediscover.
- `../../../integrations/arkeselInbound.ts` — the payload normalizer (see honesty note above).

## Setup
```bash
# .env
SMS_INBOUND_TOKEN=some-long-random-string   # optional but recommended in production
```
Point Arkesel's inbound webhook (once confirmed/provisioned) at:
`POST https://<host>/api/v1/sms-intake/inbound?token=<SMS_INBOUND_TOKEN>`

## Notes
- Malformed/unparseable webhook bodies get a `200` (not `4xx`) so the provider
  doesn't retry forever on something we can't act on anyway.
- A malformed *report command* (e.g. "hello there") isn't an error — it just
  gets the HELP text back, same as the legacy WhatsApp `HELP` command.
