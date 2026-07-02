# core/audit

Append-only audit trail (spec 03 §5). Records who did what, when — required for
accountability, government adoption, and post-incident review.

## Files
- `audit.service.ts` — `AuditService` + the `AuditRecorder` interface + `AuditEntry` type.
- `audit.repository.ts` — insert + recent-query SQL.
- DDL: `src/db/migrations/0004_audit_notifications.sql`.

## Usage
```ts
const audit = new AuditService(db);
await audit.record({ actorId, action: 'hazard.event.transition', resourceType: 'hazard_event', resourceId, placeId, metadata: { from, to } });
```

## Design
- `record()` **never throws** — an audit failure logs but must not break the audited action.
- `actor_id` / `place_id` are `ON DELETE SET NULL` so history survives deletions.
- Other modules depend on the small `AuditRecorder` interface (not the DB), so they stay decoupled
  and testable with an in-memory fake.
