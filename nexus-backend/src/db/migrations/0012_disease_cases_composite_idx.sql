-- Composite index for the outbreak evaluator's hot query path: per-disease,
-- per-place, weekly-bucket case counts over a reported_at range
-- (disease-case.repository.ts: countByDiseaseAndPlaceInWindow /
-- listDistinctPlacesWithRecentCases). Complements the single-column indexes
-- from 0011, which still cover the plain scope-list queries.
CREATE INDEX IF NOT EXISTS disease_cases_disease_place_idx ON disease_cases (disease_code, place_id, reported_at);
