-- Phase 0 Step 0.6 — Audit trail + notifications skeleton (spec 03 §5).
-- The multi-channel DELIVERY engine comes with Module F; here we lay the tables
-- + in-app notifications + subscriptions/preferences.

-- Audit: who did what, when. actor/place set NULL on delete so history survives.
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  place_id      UUID REFERENCES places(id) ON DELETE SET NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx    ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx   ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs (resource_type, resource_id);

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- Who gets alerts for where (channels + optional hazard filter)
CREATE TABLE IF NOT EXISTS subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id     UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  channels     TEXT[] NOT NULL DEFAULT '{}',
  hazard_types TEXT[],                                   -- NULL = all hazards
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS subscriptions_place_idx ON subscriptions (place_id);

-- Per-channel opt in/out
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                                 -- in_app|push|sms|whatsapp|email|voice
  enabled BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, channel)
);

-- Web-push (VAPID) endpoints
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
