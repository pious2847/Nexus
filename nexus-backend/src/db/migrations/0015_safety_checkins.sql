-- Phase 2 — spec 02 N1: "I'm Safe" safety check-in. After a hazard event,
-- people mark themselves Safe / Need Help / Injured — by SMS reply (this
-- migration), a future PWA tap, or a community focal person checking in
-- someone else on their behalf. Aggregated live per locality so responders
-- see who's unaccounted for instead of searching blindly.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_status') THEN
    CREATE TYPE safety_status AS ENUM ('safe', 'need_help', 'injured');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS safety_checkins (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id   UUID REFERENCES hazard_events(id) ON DELETE SET NULL, -- auto-resolved: the most recent open event covering place_id, if any
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  status            safety_status NOT NULL,
  subject_name      TEXT,                                  -- set when a focal person checks in someone else
  reporter_phone    TEXT,                                   -- set for SMS-sourced check-ins
  reported_by       UUID REFERENCES users(id) ON DELETE SET NULL, -- set for authenticated (PWA/moderator) check-ins
  source            TEXT NOT NULL DEFAULT 'sms',            -- sms|pwa|community_moderator
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS safety_checkins_event_idx  ON safety_checkins (hazard_event_id);
CREATE INDEX IF NOT EXISTS safety_checkins_place_idx  ON safety_checkins (place_id);
CREATE INDEX IF NOT EXISTS safety_checkins_status_idx ON safety_checkins (status);
