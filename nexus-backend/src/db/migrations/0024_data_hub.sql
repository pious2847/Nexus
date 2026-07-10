-- Module G — Data Hub (open + request-gated exchange). HDX-style dataset catalog:
-- public/by-request/private sharing, a request-approval workflow, admin QA/curation
-- before a dataset goes public, licensing/attribution, download usage analytics, and
-- API-key auth for the "Public Data API" spec calls for. Reuses the RBAC permissions
-- already seeded since Phase 0/1 (data.dataset.read / data.request.create /
-- data.request.approve / data.publish) — no new permissions needed.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dataset_sharing_mode') THEN
    CREATE TYPE dataset_sharing_mode AS ENUM ('public', 'by_request', 'private');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dataset_status') THEN
    CREATE TYPE dataset_status AS ENUM ('draft', 'pending_review', 'published', 'rejected', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dataset_license') THEN
    CREATE TYPE dataset_license AS ENUM ('cc_by', 'cc_by_sa', 'cc0', 'open_data', 'restricted', 'proprietary');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_request_status') THEN
    CREATE TYPE data_request_status AS ENUM ('pending', 'approved', 'denied');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS datasets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT,                     -- free text: flood|health|sanitation|demographics|... not FK, datasets aren't all hazard-specific
  place_id         UUID REFERENCES places(id) ON DELETE SET NULL,   -- geo scope; NULL = national
  time_range_start DATE,
  time_range_end   DATE,
  format           TEXT NOT NULL,             -- csv|geojson|excel|pdf|json
  file_url         TEXT,                      -- Cloudinary URL; a dataset can exist as metadata-only (draft) before a file is attached
  file_size_bytes  BIGINT,
  row_count        INTEGER,
  license          dataset_license NOT NULL DEFAULT 'restricted',
  attribution      TEXT,
  sharing_mode     dataset_sharing_mode NOT NULL DEFAULT 'private',
  contains_pii     BOOLEAN NOT NULL DEFAULT false,
  status           dataset_status NOT NULL DEFAULT 'draft',
  org_id           UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A public dataset can never be flagged as containing PII — the sharing-mode/PII
  -- combination the whole "privacy & anonymization" spec bullet exists to prevent.
  CONSTRAINT datasets_no_public_pii CHECK (NOT (sharing_mode = 'public' AND contains_pii))
);
CREATE INDEX IF NOT EXISTS datasets_status_idx   ON datasets (status);
CREATE INDEX IF NOT EXISTS datasets_sharing_idx  ON datasets (sharing_mode);
CREATE INDEX IF NOT EXISTS datasets_category_idx ON datasets (category);
CREATE INDEX IF NOT EXISTS datasets_place_idx    ON datasets (place_id);
CREATE INDEX IF NOT EXISTS datasets_org_idx      ON datasets (org_id);

CREATE TABLE IF NOT EXISTS data_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id     UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  requester_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  justification  TEXT NOT NULL,
  status         data_request_status NOT NULL DEFAULT 'pending',
  reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  review_notes   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_requests_dataset_idx ON data_requests (dataset_id);
CREATE INDEX IF NOT EXISTS data_requests_requester_idx ON data_requests (requester_id);
CREATE INDEX IF NOT EXISTS data_requests_status_idx ON data_requests (status);

CREATE TABLE IF NOT EXISTS data_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,          -- sha256 hex digest; the raw key is shown once at creation, never stored
  key_prefix    TEXT NOT NULL,                 -- first 8 chars of the raw key, for display/identification without exposing the secret
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS data_api_keys_org_idx ON data_api_keys (org_id);

CREATE TABLE IF NOT EXISTS dataset_downloads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id     UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  api_key_id     UUID REFERENCES data_api_keys(id) ON DELETE SET NULL,
  downloaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dataset_downloads_dataset_idx ON dataset_downloads (dataset_id);
