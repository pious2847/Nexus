-- Phase 2 — Module F: extend warning delivery tracking to email + WhatsApp
-- (push/voice remain future work — see modules/alerts/README.md). Mirrors the
-- sms_attempted/sms_delivered columns added in 0009.
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS whatsapp_attempted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS whatsapp_delivered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS email_attempted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS email_delivered INTEGER NOT NULL DEFAULT 0;
