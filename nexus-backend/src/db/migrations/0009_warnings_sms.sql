-- Phase 1 Step 1.x — SMS delivery tracking on warnings (spec 02 N9, guaranteed
-- reach: in-app alone doesn't reach citizens without the app open/installed).

ALTER TABLE warnings ADD COLUMN IF NOT EXISTS sms_attempted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS sms_delivered INTEGER NOT NULL DEFAULT 0;
