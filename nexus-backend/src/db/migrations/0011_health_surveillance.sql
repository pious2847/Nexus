-- Phase 2 — Module D: Health & Disease Surveillance (spec: MASTER_PLAN.md §4 Module D).
-- Adds the clinical/facility-sourced case pipeline + a facility registry. This is
-- separate from citizen-sourced hazard reports (modules/reports) — those already
-- support hazardType 'disease_outbreak' via the incident_reports pipeline for
-- informal "people are getting sick" signals. disease_cases is structured epi
-- data (facility/field-worker sourced) that an outbreak-detection evaluator will
-- threshold against to auto-raise 'disease_outbreak' hazard_events (the hazard
-- type already exists in the registry — see seed-hazard-types.ts).
--
-- Data-minimization: no patient names/identifiers are stored — age_group + sex
-- only, matching aggregate epidemiological surveillance, not individual case
-- files. A future "line-list / contact-tracing-lite" feature (spec N3/N-adjacent)
-- would need its own more tightly-scoped table if patient identity is required.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_status') THEN
    CREATE TYPE case_status AS ENUM ('suspected', 'probable', 'confirmed', 'ruled_out');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_source') THEN
    CREATE TYPE case_source AS ENUM ('facility', 'field_worker', 'citizen');
  END IF;
END $$;

-- Config-driven disease registry, mirrors hazard_types (seed-hazard-types.ts
-- pattern): adding a disease is a data row, not a code change.
CREATE TABLE IF NOT EXISTS disease_types (
  code                  TEXT PRIMARY KEY,              -- e.g. 'cholera', 'measles'
  label                 TEXT NOT NULL,
  idsr_priority         BOOLEAN NOT NULL DEFAULT true,  -- Ghana IDSR priority disease
  baseline_window_days  INTEGER NOT NULL DEFAULT 84,    -- rolling history used for the outbreak baseline (12 wks)
  alert_sigma           NUMERIC NOT NULL DEFAULT 2,      -- spike threshold: stdevs above the rolling weekly mean
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_facilities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  geometry          geometry(Point, 4326),
  name              TEXT NOT NULL,
  facility_type     TEXT NOT NULL DEFAULT 'clinic',     -- clinic|hospital|chps_compound|health_center
  ownership         TEXT,                                -- government|private|mission|ngo
  contact_phone     TEXT,
  bed_count         INTEGER,
  status            TEXT NOT NULL DEFAULT 'active',      -- active|closed
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disease_cases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disease_code      TEXT NOT NULL REFERENCES disease_types(code) ON DELETE RESTRICT,
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  facility_id       UUID REFERENCES health_facilities(id) ON DELETE SET NULL,
  case_status       case_status NOT NULL DEFAULT 'suspected',
  source            case_source NOT NULL DEFAULT 'facility',
  age_group         TEXT,                                -- '0-4' | '5-14' | '15-49' | '50+' | 'unknown'
  sex               TEXT,                                -- 'M' | 'F' | 'unknown'
  reported_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  onset_date        DATE,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_facilities_place_idx   ON health_facilities (place_id);
CREATE INDEX IF NOT EXISTS health_facilities_geom_gist   ON health_facilities USING gist (geometry);
CREATE INDEX IF NOT EXISTS disease_cases_place_idx       ON disease_cases (place_id);
CREATE INDEX IF NOT EXISTS disease_cases_disease_idx     ON disease_cases (disease_code);
CREATE INDEX IF NOT EXISTS disease_cases_reported_at_idx ON disease_cases (reported_at);
