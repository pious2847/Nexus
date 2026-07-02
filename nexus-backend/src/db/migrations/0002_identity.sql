-- Phase 0 Step 0.4 — Identity, organizations & geography-scoped RBAC (spec 03 §2–§3).

-- Organizations (NGOs, agencies, assemblies, academic, private, community)
CREATE TABLE IF NOT EXISTS organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  verified   BOOLEAN NOT NULL DEFAULT false,
  contact    JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RBAC reference data
CREATE TABLE IF NOT EXISTS roles (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  code        TEXT PRIMARY KEY,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

-- Scoped role grants: a user holds a role over a place (NULL place = national scope)
CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code  TEXT NOT NULL REFERENCES roles(code),
  place_id   UUID REFERENCES places(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique
  ON user_roles (user_id, role_code, COALESCE(place_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS user_roles_place_idx ON user_roles (place_id);

-- Extend users for the new model (phone/district already exist)
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_score   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id             UUID REFERENCES organizations(id);
