# modules/admin

Platform admin diagnostics + config (Module L). Previously these gaps were
either CLI-only (hazard thresholds) or didn't exist at all (system health,
integration status).

## Endpoints
All mounted at `/api/v1/admin`, gated by `config.manage` (super_admin by
default — no other role has it, matching the existing catalog's intent for
this permission).

- `GET /system-health` — DB connectivity + latency, applied-migration count
  and latest apply time (reads `drizzle.__drizzle_migrations`), whether
  scheduled hazard jobs are enabled (`ENABLE_HAZARD_JOBS`), process uptime.
- `GET /integrations-status` — read-only diagnostics for every external
  integration this codebase uses (Arkesel, Gemini, Gmail, WhatsApp, FIRMS,
  Copernicus/GloFAS, Google Maps, alert signing, Cloudinary, legacy
  Africa's Talking). Reports only `configured: boolean` + non-secret
  metadata (sender IDs, key IDs) — **never** the actual secret values, and
  never claims a credential is *valid*, only that its env vars are present
  (see [[nexus-live-test-contacts]]-style lessons: presence isn't validity —
  the WhatsApp token showed `configured: true` here despite being expired,
  which is the correct, honest behavior for a config-presence check).

## Hazard-type threshold editing
`PATCH /api/v1/hazards/types/:code` (mounted on the existing hazards router,
not this module — it's really a hazards-domain edit, just previously only
reachable via the `seed-hazard-types.ts` CLI). Body: any of
`label`/`category`/`thresholds`/`leadTimeHours`/`enabled`. Audited as
`hazard.type.updated` (the hazard-type `code` goes in audit metadata, not
`resourceId`, since `hazard_types.code` isn't a UUID and the audit
`resource_id` column is).

## Why no settings-editor for secrets
Deliberately not built: an HTTP-editable table of API keys/secrets would be
a real security regression over the current env-var-based deployment model
for no operational benefit. Secrets stay in `.env` (see `.env.example`);
this module only reports whether they're present.
