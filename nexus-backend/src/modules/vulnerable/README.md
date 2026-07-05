# modules/vulnerable

The vulnerable-persons registry (spec 02 **N4**, Module N — Life-Safety & Resilience;
MASTER_PLAN Phase 1 gap). A pre-disaster registry of people who need help evacuating
(elderly, disabled, pregnant, chronically ill, bedridden, unaccompanied minors), so
responders know **who** to reach first, not just facility counts.

**This is sensitive personal data.** Every design choice reflects that:
- **Geo-scoped RBAC only** — no endpoint ever lists "everyone nationally"; `GET /` requires
  an explicit `scope` place and is permission-checked against that specific place.
- **Consent tracked explicitly** — `consent_status` (`pending|given|guardian_given|declined`)
  + who gave it (`self|guardian|reporter_observed`) + when.
- **Every mutation audited** (register, status change, consent change).
- **Split permissions**: `field_worker` can register + read (their assigned area, like
  reports); only `district_officer`+ can change status/consent (`vulnerable.manage`) — a
  field worker can't unilaterally mark someone "deceased".
- **Data minimization** — only the fields needed for evacuation prioritization.

## Files
- `vulnerable.priority.ts` — pure, tested `evacuationPriority()`/`sortByEvacuationPriority()`
  (bedridden/unaccompanied-minor + limited mobility + household size → higher priority).
- `vulnerable.repository.ts` — SQL; `listByScope` uses ltree subtree (`path <@`), same
  pattern as the hazard map's district aggregation.
- `vulnerable.service.ts` — register/list/updateStatus/updateConsent, all audited.
- `vulnerable.routes.ts` — `/api/v1/vulnerable-persons/*`.
- DDL: `src/db/migrations/0010_vulnerable_persons.sql`.

## Endpoints
- `POST /api/v1/vulnerable-persons` — register (`vulnerable.create`, scoped to the place)
- `GET  /api/v1/vulnerable-persons?scope=<placeId>` — list a district/region's registry
  (`vulnerable.read`; `&sort=priority` to sort by evacuation priority; `&status=`/`&category=` filters)
- `GET  /api/v1/vulnerable-persons/:id` — detail (`vulnerable.read`, scoped to the record's place)
- `PATCH /api/v1/vulnerable-persons/:id/status` — active/evacuated/deceased/withdrawn (`vulnerable.manage`)
- `PATCH /api/v1/vulnerable-persons/:id/consent` — update consent (`vulnerable.manage`)

## Permissions (packages/shared/src/constants/permissions.ts)
`vulnerable.create` / `vulnerable.read` — field_worker and above.
`vulnerable.manage` — district_officer and above only.
NGOs, researchers, community moderators, and citizens get **none** by default (no blanket
PII access) — future data-sharing would go through anonymized Data Hub exports, not this API.

## What's next
- Fold registry counts into impact-based forecasting (`modules/hazards/impact.ts`) so an
  event's `impact_summary` can show "~40 vulnerable people in the affected area".
- Citizen-facing "register a vulnerable neighbor" flow (needs the PWA, spec 02 N4 mentions
  citizen-observed reports as one consent path — `consent_by: 'reporter_observed'` already
  supports this).
