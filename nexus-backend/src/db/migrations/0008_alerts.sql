-- Phase 1 Step 1.x — Alerts / dissemination (MASTER_PLAN Module F, spec 01 §11).
-- CAP-aligned alerts derived from hazard events, with tiered publish authority.
-- In-app fan-out first; multi-channel delivery (SMS/push/WhatsApp/voice) comes next.

CREATE TABLE IF NOT EXISTS warnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  place_id        UUID REFERENCES places(id) ON DELETE SET NULL,
  category        TEXT NOT NULL,                 -- CAP category: Met|Fire|Health|Geo|Env|Safety|Infra
  event_type      TEXT NOT NULL,                 -- hazard label, e.g. "Flood"
  severity        TEXT NOT NULL,                 -- minor|moderate|severe|extreme
  urgency         TEXT NOT NULL DEFAULT 'expected',
  certainty       TEXT NOT NULL DEFAULT 'likely',
  headline        TEXT NOT NULL,
  description     TEXT,
  instruction     TEXT,
  area_desc       TEXT,                          -- affected area name
  status          TEXT NOT NULL DEFAULT 'draft', -- draft|published|cancelled
  recipients      INTEGER NOT NULL DEFAULT 0,    -- how many subscribers were notified
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  published_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warnings_status_idx ON warnings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS warnings_event_idx  ON warnings (hazard_event_id);
CREATE INDEX IF NOT EXISTS warnings_place_idx  ON warnings (place_id);
