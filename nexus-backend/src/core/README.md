# core

Cross-cutting foundation that every feature module depends on. Built in Phase 0
(TypeScript, tested). Each subfolder has its own README.

| Module | Responsibility |
|--------|----------------|
| `geography/` | The national `places` tree (16 regions / 261 districts, PostGIS + ltree), point-in-district, nearest, subtree, and the legacy district-string **resolver**. |
| `rbac/` | Geography-scoped role-based access control: `can(user, permission, place)`. |
| `auth/` | Phone-OTP login, refresh-token rotation, account verification (complements legacy email/password). |
| `audit/` | Append-only audit trail (`AuditRecorder`). |
| `notifications/` | In-app notifications, subscriptions, preferences, web-push storage (delivery = Module F). |
| `http/` | Composition root (`container`) + the bridge that mounts core routers on the Express app. |

Conventions: `routes → controller → service → repository → db` (CONTRIBUTING §3).
Pure decision logic (e.g. `rbac.ts`, `geography.resolver.ts`) is isolated so it's
unit-testable without a database.
