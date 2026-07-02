-- Phase 0 Step 0.3 — National geography backbone (ADR-0007, spec 03 §1).
-- A single self-referential `places` tree that every domain record references.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS ltree;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'place_level') THEN
    CREATE TYPE place_level AS ENUM ('country', 'region', 'district', 'constituency', 'community');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS places (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES places(id) ON DELETE CASCADE,
  level       place_level NOT NULL,
  code        TEXT,                                  -- official code where available (region ISO, MMDA code)
  name        TEXT NOT NULL,
  category    TEXT,                                  -- district: metropolitan | municipal | district
  population  INTEGER,                               -- 2021 PHC where available
  centroid    geography(Point, 4326),               -- representative point (inside boundary)
  boundary    geography(MultiPolygon, 4326),        -- official polygon (null for many communities)
  path        LTREE NOT NULL,                        -- materialized path, e.g. gh.greater_accra.accra_metropolitan
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS places_path_key       ON places (path);
CREATE INDEX        IF NOT EXISTS places_path_gist      ON places USING gist (path);
CREATE INDEX        IF NOT EXISTS places_parent_idx     ON places (parent_id);
CREATE INDEX        IF NOT EXISTS places_level_idx      ON places (level);
CREATE UNIQUE INDEX IF NOT EXISTS places_level_code_key ON places (level, code) WHERE code IS NOT NULL;
CREATE INDEX        IF NOT EXISTS places_centroid_gist  ON places USING gist (centroid);
CREATE INDEX        IF NOT EXISTS places_boundary_gist  ON places USING gist (boundary);
