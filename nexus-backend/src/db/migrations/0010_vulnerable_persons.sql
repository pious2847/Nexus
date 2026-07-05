-- Phase 1 gap N4 — Vulnerable-persons registry (spec 02 N4, Module N).
-- Pre-disaster registry of people who need help evacuating. Sensitive personal
-- data: geo-scoped RBAC (vulnerable.*), consent tracked explicitly, audited on
-- every mutation. Deliberately minimal fields (data minimization).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vulnerable_category') THEN
    CREATE TYPE vulnerable_category AS ENUM (
      'elderly', 'disabled', 'pregnant', 'chronic_illness', 'bedridden', 'unaccompanied_minor', 'other'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mobility_level') THEN
    CREATE TYPE mobility_level AS ENUM ('independent', 'needs_assistance', 'wheelchair', 'bedridden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_status') THEN
    CREATE TYPE consent_status AS ENUM ('pending', 'given', 'guardian_given', 'declined');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vulnerable_persons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  geometry          geometry(Point, 4326),                    -- optional precise household location
  full_name         TEXT NOT NULL,
  category          vulnerable_category NOT NULL,
  mobility_level    mobility_level NOT NULL DEFAULT 'needs_assistance',
  household_contact_phone TEXT,
  household_size    INTEGER,
  special_needs     TEXT,                                     -- free text (e.g. "needs oxygen", "wheelchair access")
  consent_status    consent_status NOT NULL DEFAULT 'pending',
  consent_by        TEXT,                                     -- 'self' | 'guardian' | 'reporter_observed'
  consent_at        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'active',            -- active|evacuated|deceased|withdrawn
  registered_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vulnerable_persons_place_idx  ON vulnerable_persons (place_id);
CREATE INDEX IF NOT EXISTS vulnerable_persons_status_idx ON vulnerable_persons (status);
CREATE INDEX IF NOT EXISTS vulnerable_persons_geom_gist  ON vulnerable_persons USING gist (geometry);
