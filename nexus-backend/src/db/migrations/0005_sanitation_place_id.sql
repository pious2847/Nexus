-- Phase 0 Step 0.7 — Geo-tag sanitation domain tables (ADR-0007).
-- Add place_id (FK → places) alongside the legacy `district` string. The string
-- is kept and dual-read until the backfill is verified, then deprecated.

ALTER TABLE sanitation_units          ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE registered_toilets        ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE waste_facilities          ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE illegal_dump_sites        ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE gatherers                 ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE community_health_scores   ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE school_sanitation_metrics ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE sludge_jobs               ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
ALTER TABLE flood_assessments         ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sanitation_units_place_idx          ON sanitation_units (place_id);
CREATE INDEX IF NOT EXISTS registered_toilets_place_idx        ON registered_toilets (place_id);
CREATE INDEX IF NOT EXISTS waste_facilities_place_idx          ON waste_facilities (place_id);
CREATE INDEX IF NOT EXISTS illegal_dump_sites_place_idx        ON illegal_dump_sites (place_id);
CREATE INDEX IF NOT EXISTS gatherers_place_idx                 ON gatherers (place_id);
CREATE INDEX IF NOT EXISTS community_health_scores_place_idx   ON community_health_scores (place_id);
CREATE INDEX IF NOT EXISTS school_sanitation_metrics_place_idx ON school_sanitation_metrics (place_id);
CREATE INDEX IF NOT EXISTS sludge_jobs_place_idx               ON sludge_jobs (place_id);
CREATE INDEX IF NOT EXISTS flood_assessments_place_idx         ON flood_assessments (place_id);
