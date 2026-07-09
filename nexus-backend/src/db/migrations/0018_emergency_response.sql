-- Phase 2/Module M — Emergency Response & Coordination. Moves the platform
-- from *warning* people to *coordinating the response* (WMO "response"
-- pillar). Activated when a hazard event reaches active/response.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shelter_status') THEN
    CREATE TYPE shelter_status AS ENUM ('open', 'full', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_status') THEN
    CREATE TYPE dispatch_status AS ENUM ('open', 'assigned', 'in_progress', 'done', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'volunteer_availability') THEN
    CREATE TYPE volunteer_availability AS ENUM ('available', 'unavailable', 'deployed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_status') THEN
    CREATE TYPE asset_status AS ENUM ('available', 'deployed', 'maintenance');
  END IF;
END $$;

-- M1: Shelters & safe zones.
CREATE TABLE IF NOT EXISTS shelters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  geometry          geometry(Point, 4326),
  name              TEXT NOT NULL,
  capacity          INTEGER,
  current_occupancy INTEGER NOT NULL DEFAULT 0,
  facilities        TEXT[] NOT NULL DEFAULT '{}',   -- e.g. water, medical, electricity, sanitation
  status            shelter_status NOT NULL DEFAULT 'open',
  contact_phone     TEXT,
  managed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shelters_place_idx  ON shelters (place_id);
CREATE INDEX IF NOT EXISTS shelters_status_idx ON shelters (status);
CREATE INDEX IF NOT EXISTS shelters_geom_gist  ON shelters USING gist (geometry);

-- M2: Relief inventory — stock levels + distributions.
CREATE TABLE IF NOT EXISTS relief_stocks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id           UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  shelter_id         UUID REFERENCES shelters(id) ON DELETE SET NULL,
  item_type          TEXT NOT NULL,                 -- food|water|tents|medical_kits|blankets|other
  quantity           INTEGER NOT NULL DEFAULT 0,
  unit               TEXT NOT NULL DEFAULT 'units',
  low_stock_threshold INTEGER NOT NULL DEFAULT 0,
  managed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relief_stocks_place_idx   ON relief_stocks (place_id);
CREATE INDEX IF NOT EXISTS relief_stocks_shelter_idx ON relief_stocks (shelter_id);

CREATE TABLE IF NOT EXISTS relief_distributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        UUID NOT NULL REFERENCES relief_stocks(id) ON DELETE RESTRICT,
  hazard_event_id UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  quantity        INTEGER NOT NULL,
  recipient_desc  TEXT,                              -- free text: "Tolon shelter #2", "40 households in Sagnerigu"
  distributed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relief_distributions_stock_idx ON relief_distributions (stock_id);
CREATE INDEX IF NOT EXISTS relief_distributions_event_idx ON relief_distributions (hazard_event_id);

-- M3: Incident dispatch & tasking.
CREATE TABLE IF NOT EXISTS dispatch_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id UUID REFERENCES hazard_events(id) ON DELETE SET NULL,
  place_id        UUID REFERENCES places(id) ON DELETE SET NULL,
  geometry        geometry(Point, 4326),
  task_type       TEXT NOT NULL,                     -- rescue|assessment|distribution|repair|other
  description     TEXT,
  priority        TEXT NOT NULL DEFAULT 'normal',     -- low|normal|high|critical
  status          dispatch_status NOT NULL DEFAULT 'open',
  assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
  source_type     TEXT,                               -- 'sos'|'manual'|'report' — what created this task
  source_id       UUID,                                -- e.g. the sos_alerts.id that auto-created this task
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dispatch_tasks_event_idx  ON dispatch_tasks (hazard_event_id);
CREATE INDEX IF NOT EXISTS dispatch_tasks_place_idx  ON dispatch_tasks (place_id);
CREATE INDEX IF NOT EXISTS dispatch_tasks_status_idx ON dispatch_tasks (status);
CREATE INDEX IF NOT EXISTS dispatch_tasks_geom_gist  ON dispatch_tasks USING gist (geometry);

-- M3b: a lightweight status-change log — the raw material for the M5 after-action timeline.
CREATE TABLE IF NOT EXISTS dispatch_task_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES dispatch_tasks(id) ON DELETE CASCADE,
  from_status dispatch_status,
  to_status   dispatch_status NOT NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatch_task_events_task_idx ON dispatch_task_events (task_id);

-- M4: Volunteer & resource coordination.
CREATE TABLE IF NOT EXISTS volunteers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,  -- nullable: a volunteer may not have a full account
  name          TEXT NOT NULL,
  phone         TEXT,
  place_id      UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,  -- base location
  skills        TEXT[] NOT NULL DEFAULT '{}',
  availability  volunteer_availability NOT NULL DEFAULT 'available',
  assigned_task UUID REFERENCES dispatch_tasks(id) ON DELETE SET NULL,
  registered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS volunteers_place_idx        ON volunteers (place_id);
CREATE INDEX IF NOT EXISTS volunteers_availability_idx ON volunteers (availability);

CREATE TABLE IF NOT EXISTS response_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  asset_type    TEXT NOT NULL,                        -- vehicle|boat|equipment|other
  place_id      UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  status        asset_status NOT NULL DEFAULT 'available',
  assigned_task UUID REFERENCES dispatch_tasks(id) ON DELETE SET NULL,
  notes         TEXT,
  registered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS response_assets_place_idx  ON response_assets (place_id);
CREATE INDEX IF NOT EXISTS response_assets_status_idx ON response_assets (status);
