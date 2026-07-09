-- Module C — light gamification (badges & recognition for verified citizen
-- contributions; spec 03 §? / MASTER_PLAN §4 Module C). Deliberately NO
-- cash/airtime rewards, per the decided trust model — badges only, to avoid
-- incentivizing fake reports in a data-collection system. Historical bulk
-- import (the other Module C item) stays correctly deferred to Phase 3 per
-- MASTER_PLAN §11 — not part of this migration.

CREATE TABLE IF NOT EXISTS badges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,          -- stable machine key, e.g. 'first_report'
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  icon          TEXT,                          -- emoji or icon identifier for the frontend
  criteria_type TEXT NOT NULL,                 -- 'verified_count' | 'reputation_threshold'
  criteria_value INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS user_badges_user_idx ON user_badges (user_id);

INSERT INTO badges (code, name, description, icon, criteria_type, criteria_value) VALUES
  ('first_report',       'First Verified Report',   'Your first citizen report was verified by an officer.', '🌱', 'verified_count', 1),
  ('trusted_reporter',   'Trusted Reporter',         '5 of your reports have been verified.',                 '⭐', 'verified_count', 5),
  ('community_guardian', 'Community Guardian',       '20 of your reports have been verified.',                '🛡️', 'verified_count', 20),
  ('reliable_voice',     'Reliable Voice',           'Reached a reputation score of 50.',                     '📣', 'reputation_threshold', 50),
  ('pillar_of_community','Pillar of the Community',  'Reached the maximum reputation score of 100.',          '🏆', 'reputation_threshold', 100)
ON CONFLICT (code) DO NOTHING;
