-- Phase 2 — spec 02 N10: alert authentication / anti-spoofing. Published
-- alerts are signed (Ed25519); the public can verify authenticity via
-- GET /api/v1/warnings/:id/verify against the published public key without
-- trusting the server's own claim (modules/alerts/alerts.signing.ts).
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS signing_key_id TEXT;
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
