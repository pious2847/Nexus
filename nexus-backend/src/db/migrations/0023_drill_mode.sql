-- N13 — Drills, simulation & test mode. Additive: `is_drill` defaults false, so every
-- existing row and every existing query that doesn't know about this column keeps its
-- current behavior exactly. Application code explicitly opts a query INTO excluding
-- drills (public hazard map, executive analytics) rather than the column silently
-- changing what anything already returns.

ALTER TABLE hazard_events ADD COLUMN IF NOT EXISTS is_drill BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS hazard_events_is_drill_idx ON hazard_events (is_drill) WHERE is_drill;
