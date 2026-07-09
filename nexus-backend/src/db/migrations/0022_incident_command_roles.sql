-- N14 — Common Operating Picture + Incident Command. No new data to collect (the COP
-- is a read-side aggregation over already-existing event-linked tables — reports,
-- dispatch tasks, safety check-ins, damage assessments, relief distributions, rumor
-- reports, shelters, SOS alerts) except a lightweight ICS role-assignment record:
-- who is Incident Commander / Operations / Logistics / etc. for a given hazard event.

CREATE TABLE IF NOT EXISTS incident_command_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_event_id UUID NOT NULL REFERENCES hazard_events(id) ON DELETE CASCADE,
  role_title      TEXT NOT NULL,   -- e.g. incident_commander|operations|logistics|planning|finance|liaison|safety_officer|pio
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  relieved_at     TIMESTAMPTZ  -- set when this assignment ends (a new one may follow for the same role)
);
CREATE INDEX IF NOT EXISTS incident_command_roles_event_idx ON incident_command_roles (hazard_event_id);
-- At most one ACTIVE (not yet relieved) holder of a given role per event.
CREATE UNIQUE INDEX IF NOT EXISTS incident_command_roles_active_unique
  ON incident_command_roles (hazard_event_id, role_title) WHERE relieved_at IS NULL;
