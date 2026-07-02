# Spec 03 — Foundation Data Model (Core / Module A)

> The schema the entire platform is built on: **geography, identity, access control, orgs,
> auth, notifications, audit**. This is what code is written against in Phase 0. Designed for
> PostgreSQL + PostGIS via Drizzle (ADR-0003, 0007).
>
> Parent: [MASTER_PLAN.md](../MASTER_PLAN.md) §Module A. **Date:** 2026-07-02.

Conventions for every table: `id` UUID PK (`gen_random_uuid()`), `created_at`/`updated_at`
`timestamptz default now()`, soft-reference geography via `place_id`. Types shown are logical
(Drizzle/PostGIS equivalents in parentheses where useful).

---

## 1. Geography — the `places` tree (ADR-0007)
A single self-referential table is the canonical location for **everything** (reports,
hazards, alerts, assets, datasets all reference `place_id`). This replaces the free-text
`district` string used today.

### `places`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| parent_id | UUID FK → places.id | null for country root |
| level | enum | `country` \| `region` \| `district` \| `constituency` \| `community` |
| code | text | official code where available (region/MMDA code); unique per level |
| name | text | |
| category | text null | for districts: `metropolitan` \| `municipal` \| `district` |
| centroid | geography(Point,4326) | for distance/nearest queries + citizen location bucketing |
| boundary | geography(MultiPolygon,4326) null | official polygon (region/district); null for many communities |
| population | integer null | 2021 PHC where available (region/district) |
| path | ltree or text | materialized path for fast subtree queries (e.g. `gh.northern.tolon`) |
| metadata | jsonb | capital, area_km2, alt names, etc. |

**Seed at Phase 0:** 1 country + **16 regions** + **261 districts** (verified current count,
not 170/216) from geoBoundaries/data.gov.gh, with boundary + population attached where
available. Communities are added over time (by imports, field workers, citizen reports).

**Query patterns:** subtree via `path` (ltree `<@`) or recursive CTE; "which district
contains this point" via `ST_Contains(boundary, point)`; "nearest shelter/community" via
`centroid <-> point` (KNN). H3 cells used for aggregation & anonymizing citizen locations.

---

## 2. Identity & organizations

### `organizations`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | text | |
| type | enum | `government_agency` \| `ngo` \| `assembly` \| `academic` \| `private` \| `community` |
| verified | boolean default false | vetting for data access |
| contact | jsonb | email/phone/website |
| metadata | jsonb | |

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| email | citext unique null | null allowed for phone-only citizens |
| phone | text unique null | E.164; primary identifier for citizens (OTP login) |
| password_hash | text null | null for OTP-only accounts (bcrypt when set) |
| full_name | text | |
| status | enum | `pending` \| `active` \| `suspended` |
| org_id | UUID FK → organizations null | |
| reputation_score | integer default 0 | citizen report trust (spec: verification+reputation) |
| preferred_language | text default 'en' | `en` \| `tw` \| `ee` \| `dag` \| `gaa` \| `ha` … |
| last_active_at | timestamptz null | |

> Constraint: at least one of `email`/`phone` present.

---

## 3. Access control (RBAC + geo-scope)
Roles are **geography-scoped**: a user can hold a role over a specific place (national =
root place, region, district, etc.). Permissions are code constants mapped to roles.

### `roles` (seeded, static)
`code` PK, `label`, `description`. Seed: `super_admin`, `national_agency`,
`regional_coordinator`, `district_officer`, `field_worker`, `community_moderator`,
`ngo_partner`, `researcher`, `data_consumer`, `citizen`.

### `permissions` (seeded, static)
`code` PK (e.g. `hazard.event.create`, `alert.publish.severe`, `data.request.approve`,
`report.verify`, `user.manage`), `description`.

### `role_permissions`
`role_code` FK, `permission_code` FK. (Composite PK.) Defines what each role can do.

### `user_roles` (the scoped grant)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK → users | |
| role_code | text FK → roles | |
| place_id | UUID FK → places null | scope; null = national |
| granted_by | UUID FK → users null | |
| granted_at | timestamptz | |

**Enforcement:** middleware resolves the caller's roles → permissions, and checks the target
resource's `place_id` is within the user's granted `place_id` subtree (via `path`). One
documented function: `can(user, permission, targetPlaceId)`.

---

## 4. Authentication support

### `refresh_tokens`
`id`, `user_id` FK, `token_hash`, `expires_at`, `revoked_at` null, `user_agent`, `ip`.

### `otp_codes` (citizen phone login + verification)
`id`, `phone`, `code_hash`, `purpose` (`login`\|`verify`), `expires_at`, `attempts`,
`consumed_at` null. Rate-limited; codes short-lived. Delivered via Arkesel SMS.

### `account_verifications` (officials/NGOs/researchers vetting)
`id`, `user_id` FK, `requested_role`, `org_id` null, `evidence` jsonb, `status`
(`pending`\|`approved`\|`rejected`), `reviewed_by` null, `reviewed_at` null.

---

## 5. Notifications & audit (cross-cutting foundation)

### `notifications` (in-app)
`id`, `user_id` FK, `type`, `title`, `body`, `data` jsonb, `read_at` null, `created_at`.

### `notification_preferences`
`user_id` FK, `channel` (`in_app`\|`push`\|`sms`\|`whatsapp`\|`email`\|`voice`), `enabled`,
plus subscribed `place_id`s (separate `subscriptions` table below). Feeds Module F.

### `subscriptions` (who gets alerts for where)
`id`, `user_id` FK, `place_id` FK, `channels` text[], `hazard_types` text[] null (null = all).

### `push_subscriptions` (web-push/VAPID)
`id`, `user_id` FK, `endpoint`, `p256dh`, `auth`, `created_at`.

### `audit_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| actor_id | UUID FK → users null | null for system |
| action | text | e.g. `alert.published`, `hazard.event.transition`, `data.request.approved` |
| resource_type | text | |
| resource_id | UUID null | |
| place_id | UUID FK → places null | |
| metadata | jsonb | before/after, reason, snapshot |
| ip | inet null | |
| created_at | timestamptz | |

Audit is written for every sensitive/critical action — mandatory for a system government may
adopt, and for post-incident review.

---

## 6. How existing tables adapt
The existing sanitation tables (`sanitation_units`, `registered_toilets`, `sludge_jobs`,
`gatherers`, `waste_facilities`, `illegal_dump_sites`, `school_sanitation_metrics`,
`community_health_scores`, `alerts`, etc.) are kept but gain a **`place_id` FK** and are
moved under `modules/sanitation`. Their current free-text `district` column is backfilled to
`place_id` during migration (spec 04), then deprecated.

Hazard/EWS tables (`hazard_types`, `hazard_events`, `predictions`, `event_transitions`,
`risk_zones`, `risk_profiles`, `warning_approvals`) are defined in
[spec 01 §12](01-multi-hazard-ews.md) and also reference `places`.

---

## 7. Entity relationship (foundation, simplified)
```
places (self ref: parent_id) ──< everything.place_id

organizations ──< users ──< user_roles >── roles ──< role_permissions >── permissions
                     │                         │
                     │                         └─ user_roles.place_id ──> places
                     ├──< refresh_tokens
                     ├──< otp_codes (by phone)
                     ├──< account_verifications
                     ├──< notifications / subscriptions / push_subscriptions
                     └──< audit_logs (actor)
```

---

## 8. Phase 0 deliverable for this spec
1. Drizzle schema for all tables above + PostGIS enabled + `ltree` extension.
2. Migrations generated (baseline import of current schema.sql, then foundation tables).
3. Seeders: 16 regions + 261 districts (+ boundary/population), roles, permissions,
   role_permissions, a super_admin.
4. `can(user, permission, placeId)` RBAC helper + middleware, unit-tested.
5. Auth: email/password (existing) **+** phone OTP (new), refresh tokens.
6. Audit logging middleware/helper.

Open data-prep task (tracked in findings-01): obtain & verify the current 16/261 boundary +
2021 population dataset before seeding.
