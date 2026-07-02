-- Phase 1 Step 1.1 — Multi-hazard core (spec 01 §2,§4,§12).
-- Config-driven hazard types + event lifecycle + transitions + predictions.

-- Config: adding a hazard = a row here (+ optionally an evaluator strategy).
CREATE TABLE IF NOT EXISTS hazard_types (
  code               TEXT PRIMARY KEY,          -- flood | heavy_rainfall | bushfire | ...
  label              TEXT NOT NULL,
  category           TEXT NOT NULL,             -- CAP category: Met|Geo|Fire|Health|Env|Safety|Infra
  default_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  signal_sources     JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluator_key      TEXT NOT NULL DEFAULT 'rules',
  lead_time_hours    INTEGER,
  enabled            BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A specific hazard, at a place, over a time window. CAP-aligned classification.
CREATE TABLE IF NOT EXISTS hazard_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_type    TEXT NOT NULL REFERENCES hazard_types(code),
  place_id       UUID REFERENCES places(id) ON DELETE SET NULL,
  geometry       geometry(Geometry, 4326),               -- optional point/polygon footprint
  state          TEXT NOT NULL DEFAULT 'predicted',      -- predicted→…→closed (state machine)
  severity       TEXT,                                    -- minor|moderate|severe|extreme
  urgency        TEXT,                                    -- future|expected|immediate
  certainty      TEXT,                                    -- possible|likely|observed
  color          TEXT,                                    -- derived colour band
  title          TEXT NOT NULL,
  description    TEXT,
  confidence     NUMERIC,
  impact_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at     TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  source         TEXT NOT NULL DEFAULT 'manual',          -- manual | auto
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hazard_events_type_place_state_idx ON hazard_events (hazard_type, place_id, state);
CREATE INDEX IF NOT EXISTS hazard_events_state_idx            ON hazard_events (state, created_at DESC);
CREATE INDEX IF NOT EXISTS hazard_events_place_idx            ON hazard_events (place_id);
CREATE INDEX IF NOT EXISTS hazard_events_geom_gist            ON hazard_events USING gist (geometry);

-- Audit of every lifecycle transition (with the data that justified it).
CREATE TABLE IF NOT EXISTS event_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id UUID NOT NULL REFERENCES hazard_events(id) ON DELETE CASCADE,
  from_state      TEXT,
  to_state        TEXT NOT NULL,
  actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  data_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_transitions_event_idx ON event_transitions (hazard_event_id, created_at);

-- Risk predictions (rule/external/ML), with provenance for explainability + training.
-- Named hazard_predictions to avoid collision with the legacy `predictions` table.
CREATE TABLE IF NOT EXISTS hazard_predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  hazard_type     TEXT NOT NULL REFERENCES hazard_types(code),
  place_id        UUID REFERENCES places(id) ON DELETE SET NULL,
  risk_score      NUMERIC,
  confidence      NUMERIC,
  factors         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluator_key   TEXT,
  model_version   TEXT,
  valid_from      TIMESTAMPTZ,
  valid_to        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hazard_predictions_type_place_idx ON hazard_predictions (hazard_type, place_id, created_at DESC);
