-- N15 (rapid damage & needs assessment) + N16 (health-facility capacity &
-- mass-casualty coordination). Two independent verticals bundled since
-- neither touches the other's tables.

-- N15: structured post-event assessment (households/persons affected,
-- casualties, damage, urgent needs), geo-tagged, rolling up to a situation
-- report via aggregation queries (no separate sitrep table needed).
CREATE TABLE IF NOT EXISTS damage_assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id              UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  hazard_event_id       UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  geometry              geometry(Point, 4326),
  households_affected   INTEGER NOT NULL DEFAULT 0,
  persons_affected      INTEGER NOT NULL DEFAULT 0,
  casualties            INTEGER NOT NULL DEFAULT 0,
  injuries              INTEGER NOT NULL DEFAULT 0,
  infrastructure_damage TEXT,
  urgent_needs          TEXT[] NOT NULL DEFAULT '{}',   -- water|shelter|medical|food|sanitation|other
  media                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                 TEXT,
  assessed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS damage_assessments_place_idx ON damage_assessments (place_id);
CREATE INDEX IF NOT EXISTS damage_assessments_event_idx ON damage_assessments (hazard_event_id);
CREATE INDEX IF NOT EXISTS damage_assessments_geom_gist ON damage_assessments USING gist (geometry);

-- N16: live facility capacity as a time series (beds/blood/ambulances change
-- far more often than the static health_facilities registry row) — a new
-- report is inserted each time, never updated in place, so "latest per
-- facility" is always the true current status without losing history.
CREATE TABLE IF NOT EXISTS facility_capacity_status (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id           UUID NOT NULL REFERENCES health_facilities(id) ON DELETE CASCADE,
  beds_available        INTEGER,
  blood_units_available INTEGER,
  ambulances_available  INTEGER,
  status                TEXT NOT NULL DEFAULT 'normal', -- normal|strained|overwhelmed|closed
  reported_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facility_capacity_status_facility_idx ON facility_capacity_status (facility_id, reported_at DESC);
