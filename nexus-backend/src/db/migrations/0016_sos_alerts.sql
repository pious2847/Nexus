-- Phase 2 — spec 02 N2: SOS / panic button. A citizen in immediate danger
-- sends an SOS with location; this creates a high-priority alert and
-- immediately notifies (SMS + in-app) every responder whose role/geo-scope
-- covers the affected place. Module M (formal dispatch tasking) doesn't
-- exist yet, so this v1 achieves the "minutes matter" goal via immediate
-- notification rather than a dispatch board — see modules/safety/README.md.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sos_status') THEN
    CREATE TYPE sos_status AS ENUM ('open', 'acknowledged', 'resolved', 'false_alarm');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sos_location_precision') THEN
    -- 'gps': exact device coordinates (PWA button press, future).
    -- 'district_centroid': degraded precision — SMS can't carry live GPS, so an
    -- SMS-originated SOS is placed at its resolved district's centroid instead.
    CREATE TYPE sos_location_precision AS ENUM ('gps', 'district_centroid');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sos_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id             UUID REFERENCES places(id) ON DELETE SET NULL,
  geometry             geometry(Point, 4326) NOT NULL,
  location_precision   sos_location_precision NOT NULL DEFAULT 'gps',
  status               sos_status NOT NULL DEFAULT 'open',
  danger_type          TEXT,                                    -- free text: 'flood'|'fire'|'medical'|... (not a rigid enum — seconds matter)
  notes                TEXT,
  reporter_phone       TEXT,
  reported_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  responders_notified  INTEGER NOT NULL DEFAULT 0,
  acknowledged_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at      TIMESTAMPTZ,
  resolved_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sos_alerts_place_idx  ON sos_alerts (place_id);
CREATE INDEX IF NOT EXISTS sos_alerts_status_idx ON sos_alerts (status);
CREATE INDEX IF NOT EXISTS sos_alerts_geom_gist  ON sos_alerts USING gist (geometry);
