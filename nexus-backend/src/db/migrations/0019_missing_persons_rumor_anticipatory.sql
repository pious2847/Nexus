-- Phase 2/Module N gaps — N3 (missing persons & family reunification),
-- N11 (rumor & misinformation control), N12 (anticipatory action /
-- forecast-based triggers). Three independent verticals bundled into one
-- migration since none of them touch the others' tables.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'missing_person_status') THEN
    CREATE TYPE missing_person_status AS ENUM ('missing', 'found', 'reunified', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rumor_status') THEN
    CREATE TYPE rumor_status AS ENUM ('reported', 'reviewing', 'confirmed_false', 'confirmed_true', 'clarified');
  END IF;
END $$;

-- N3: Missing persons & family reunification. Matching against N1 safety
-- check-ins (subject_name) and the N4 vulnerable-persons registry is done at
-- the service layer (fuzzy name + geo-scope), not via a DB trigger — a human
-- confirms a match before it's recorded here.
CREATE TABLE IF NOT EXISTS missing_persons (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id                    UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  full_name                   TEXT NOT NULL,
  age_estimate                TEXT,                      -- free text: "8", "elderly", "40s" — often unknown/approximate
  sex                         TEXT,
  distinguishing_features     TEXT,
  photo_url                   TEXT,
  last_seen_location          geometry(Point, 4326),
  last_seen_at                TIMESTAMPTZ,
  reporter_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_phone              TEXT NOT NULL,
  relationship_to_missing     TEXT,                      -- e.g. parent, sibling, neighbor, focal point
  status                      missing_person_status NOT NULL DEFAULT 'missing',
  matched_checkin_id          UUID REFERENCES safety_checkins(id) ON DELETE SET NULL,
  matched_vulnerable_person_id UUID REFERENCES vulnerable_persons(id) ON DELETE SET NULL,
  resolved_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at                 TIMESTAMPTZ,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS missing_persons_place_idx  ON missing_persons (place_id);
CREATE INDEX IF NOT EXISTS missing_persons_status_idx ON missing_persons (status);
CREATE INDEX IF NOT EXISTS missing_persons_name_trgm  ON missing_persons USING gin (full_name gin_trgm_ops);

-- N11: Rumor intake + official myth-vs-fact clarifications.
CREATE TABLE IF NOT EXISTS rumor_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id         UUID REFERENCES places(id) ON DELETE SET NULL,
  hazard_event_id  UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  source           TEXT,                                 -- where it was heard: radio|social_media|word_of_mouth|other
  reporter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_phone   TEXT,
  status           rumor_status NOT NULL DEFAULT 'reported',
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rumor_reports_place_idx ON rumor_reports (place_id);
CREATE INDEX IF NOT EXISTS rumor_reports_event_idx ON rumor_reports (hazard_event_id);
CREATE INDEX IF NOT EXISTS rumor_reports_status_idx ON rumor_reports (status);

CREATE TABLE IF NOT EXISTS myth_fact_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id   UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  place_id          UUID REFERENCES places(id) ON DELETE SET NULL,
  myth              TEXT NOT NULL,
  fact              TEXT NOT NULL,
  rumor_report_id   UUID REFERENCES rumor_reports(id) ON DELETE SET NULL,
  published_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channels_notified JSONB NOT NULL DEFAULT '[]'::jsonb,   -- fan-out summary, same shape as warnings' delivery counters
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS myth_fact_entries_place_idx ON myth_fact_entries (place_id);
CREATE INDEX IF NOT EXISTS myth_fact_entries_event_idx ON myth_fact_entries (hazard_event_id);

-- N12: Anticipatory action / forecast-based triggers. A protocol fires when
-- a hazard event of `hazard_type` in `place_id` (or a descendant place)
-- reaches `trigger_state`; `actions` is executed by the hazard-event
-- transition path and logged to `protocol_activations`.
CREATE TABLE IF NOT EXISTS anticipatory_protocols (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  hazard_type   TEXT NOT NULL REFERENCES hazard_types(code) ON DELETE RESTRICT,
  place_id      UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  trigger_state TEXT NOT NULL,                            -- a hazard_events.state value, e.g. 'watch'|'warning'
  actions       JSONB NOT NULL,                            -- [{type: 'notify_focal_points'|'flag_vulnerable_evacuation'|'pre_position_relief', params: {...}}]
  active        BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anticipatory_protocols_hazard_idx ON anticipatory_protocols (hazard_type, place_id) WHERE active;

CREATE TABLE IF NOT EXISTS protocol_activations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id     UUID NOT NULL REFERENCES anticipatory_protocols(id) ON DELETE CASCADE,
  hazard_event_id UUID NOT NULL REFERENCES hazard_events(id) ON DELETE CASCADE,
  actions_taken   JSONB NOT NULL,                          -- results/outcomes per action, for audit
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_activations_protocol_idx ON protocol_activations (protocol_id);
CREATE INDEX IF NOT EXISTS protocol_activations_event_idx    ON protocol_activations (hazard_event_id);
-- A protocol should fire at most once per hazard event (not once per transition through the state).
CREATE UNIQUE INDEX IF NOT EXISTS protocol_activations_unique ON protocol_activations (protocol_id, hazard_event_id);
