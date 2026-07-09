-- Phase 2 — spec 02 N6: last-mile community alerting (beyond phones). In
-- rural Ghana the fastest reliable channel is often the local FM station or
-- a trusted person shouting through town — not an app. Sirens/PA hardware
-- and live radio-station broadcast automation have no integratable API
-- (genuinely out of scope for a software platform); what IS buildable is a
-- registry of human/institutional relay points — community focal persons
-- ("digital town-crier"), radio stations, and physical notice boards — who
-- get a broadcast-ready script through the SAME already-built SMS/email/
-- WhatsApp adapters, then relay it door-to-door / on-air / by gong-gong.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'focal_relay_method') THEN
    CREATE TYPE focal_relay_method AS ENUM (
      'door_to_door', 'gong_gong', 'loudhailer', 'radio_broadcast', 'notice_board'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS community_focal_points (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id       UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,                       -- person's name, or a station/institution name
  relay_method   focal_relay_method NOT NULL,
  station_name   TEXT,                                 -- set when relay_method = 'radio_broadcast'
  contact_phone  TEXT,                                 -- used for SMS/WhatsApp delivery of the broadcast script
  contact_email  TEXT,                                 -- used for email delivery (e.g. a station's newsroom inbox)
  notes          TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  registered_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_focal_points_place_idx  ON community_focal_points (place_id);
CREATE INDEX IF NOT EXISTS community_focal_points_active_idx ON community_focal_points (active);

-- Dissemination tracking, mirroring sms/whatsapp/email_attempted+delivered on warnings.
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS focal_points_notified INTEGER NOT NULL DEFAULT 0;
