-- Phase 1 Step 1.3 — Citizen incident reporting (MASTER_PLAN Module C).
-- Trust model: verification + reputation (users.reputation_score) + corroboration
-- (clustered nearby reports raise confidence).

CREATE TABLE IF NOT EXISTS incident_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id        UUID REFERENCES users(id) ON DELETE SET NULL,   -- null for anonymous/SMS
  reporter_phone     TEXT,
  hazard_type        TEXT REFERENCES hazard_types(code),             -- null if reporter unsure
  place_id           UUID REFERENCES places(id) ON DELETE SET NULL,
  geometry           geometry(Point, 4326),
  title              TEXT NOT NULL,
  description        TEXT,
  media              JSONB NOT NULL DEFAULT '[]'::jsonb,             -- uploaded photo urls
  status             TEXT NOT NULL DEFAULT 'submitted',              -- submitted|verified|rejected|promoted
  confidence         NUMERIC NOT NULL DEFAULT 0,
  corroboration_count INTEGER NOT NULL DEFAULT 0,
  cluster_id         UUID,                                           -- groups corroborating reports
  verified_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  rejection_reason   TEXT,
  promoted_event_id  UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  source             TEXT NOT NULL DEFAULT 'pwa',                    -- pwa|sms|whatsapp|voice
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_reports_status_idx  ON incident_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incident_reports_type_idx    ON incident_reports (hazard_type, created_at DESC);
CREATE INDEX IF NOT EXISTS incident_reports_place_idx   ON incident_reports (place_id);
CREATE INDEX IF NOT EXISTS incident_reports_cluster_idx ON incident_reports (cluster_id);
CREATE INDEX IF NOT EXISTS incident_reports_geom_gist   ON incident_reports USING gist (geometry);
