-- N.E.X.U.S. Database Schema — Neon PostgreSQL
-- Northern Environmental X-system for Universal Sanitation

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'district_officer', 'sanitation_worker', 'school_admin', 'ngo_staff')),
  phone TEXT,
  district TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sanitation units
CREATE TABLE IF NOT EXISTS sanitation_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK(unit_type IN ('pit_latrine', 'flush_toilet', 'biodigester', 'ecosan', 'public_toilet')),
  location_name TEXT NOT NULL,
  district TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  capacity INTEGER DEFAULT 1,
  is_school BOOLEAN DEFAULT false,
  school_name TEXT,
  student_population INTEGER,
  elevation_meters DOUBLE PRECISION,
  flood_zone_risk TEXT DEFAULT 'low' CHECK(flood_zone_risk IN ('low', 'moderate', 'high', 'critical')),
  is_solar_powered BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'operational' CHECK(status IN ('operational', 'maintenance', 'offline', 'critical')),
  installed_at TIMESTAMPTZ,
  last_maintained TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sensor readings
CREATE TABLE IF NOT EXISTS sensor_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES sanitation_units(id) ON DELETE CASCADE,
  fill_level_percent DOUBLE PRECISION NOT NULL CHECK(fill_level_percent BETWEEN 0 AND 100),
  water_level_cm DOUBLE PRECISION DEFAULT 0,
  temperature_celsius DOUBLE PRECISION,
  humidity_percent DOUBLE PRECISION,
  gas_ppm DOUBLE PRECISION DEFAULT 0,
  battery_percent DOUBLE PRECISION DEFAULT 100,
  signal_strength INTEGER,
  is_simulated BOOLEAN DEFAULT false,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI predictions
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES sanitation_units(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL CHECK(prediction_type IN ('overflow', 'flood_risk', 'maintenance', 'contamination')),
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'moderate', 'high', 'critical')),
  risk_score DOUBLE PRECISION NOT NULL CHECK(risk_score BETWEEN 0 AND 100),
  predicted_event_at TIMESTAMPTZ,
  confidence_percent DOUBLE PRECISION,
  ai_reasoning TEXT,
  recommendations JSONB,
  weather_data JSONB,
  sensor_snapshot JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES sanitation_units(id) ON DELETE CASCADE,
  prediction_id UUID REFERENCES predictions(id),
  alert_type TEXT NOT NULL CHECK(alert_type IN ('overflow_imminent', 'flood_risk', 'gas_hazard', 'maintenance_due', 'contamination_risk', 'system_offline')),
  severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'danger', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  sms_sent BOOLEAN DEFAULT false,
  sms_recipients JSONB,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Community incident reports
CREATE TABLE IF NOT EXISTS community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES sanitation_units(id),
  reported_by UUID REFERENCES users(id),
  reporter_name TEXT,
  reporter_phone TEXT,
  report_type TEXT NOT NULL CHECK(report_type IN ('overflow', 'damage', 'hygiene_issue', 'flooding', 'blocked', 'security', 'other')),
  description TEXT NOT NULL,
  severity TEXT DEFAULT 'moderate' CHECK(severity IN ('low', 'moderate', 'high', 'critical')),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  photo_url TEXT,
  ai_analysis JSONB,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'resolved')),
  assigned_to UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weather cache
CREATE TABLE IF NOT EXISTS weather_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  weather_data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Maintenance logs
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES sanitation_units(id) ON DELETE CASCADE,
  performed_by UUID REFERENCES users(id),
  worker_name TEXT NOT NULL,
  maintenance_type TEXT NOT NULL,
  description TEXT,
  cost_ghs DOUBLE PRECISION DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  next_maintenance_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (V1)
CREATE INDEX IF NOT EXISTS idx_sensor_readings_unit_id ON sensor_readings(unit_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_recorded_at ON sensor_readings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unit_id ON alerts(unit_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_predictions_unit_id ON predictions(unit_id);
CREATE INDEX IF NOT EXISTS idx_predictions_risk_level ON predictions(risk_level);
CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports(status);
CREATE INDEX IF NOT EXISTS idx_sanitation_units_district ON sanitation_units(district);
CREATE INDEX IF NOT EXISTS idx_weather_cache_district ON weather_cache(district, expires_at);

-- ─────────────────────────────────────────────────────────────────
-- V2 TABLES — Extended N.E.X.U.S. Feature Set
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS registered_toilets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  toilet_type TEXT NOT NULL CHECK(toilet_type IN ('pit_latrine','flush_toilet','biodigester','ecosan','ventilated_pit','bucket','other')),
  ownership_type TEXT NOT NULL CHECK(ownership_type IN ('household','public','school','private_business','health_facility')),
  location_name TEXT NOT NULL,
  district TEXT NOT NULL,
  community TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  condition TEXT DEFAULT 'unknown' CHECK(condition IN ('good','fair','poor','non_functional','unknown')),
  num_users INTEGER DEFAULT 1,
  has_water BOOLEAN DEFAULT false,
  has_handwashing BOOLEAN DEFAULT false,
  photo_url TEXT,
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES users(id),
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waste_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  facility_type TEXT NOT NULL CHECK(facility_type IN ('sewage_treatment','composting','biogas_plant','faecal_sludge_management','landfill','transfer_station','other')),
  operator TEXT,
  district TEXT NOT NULL,
  community TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  capacity_m3 DOUBLE PRECISION,
  current_load_pct DOUBLE PRECISION DEFAULT 0 CHECK(current_load_pct BETWEEN 0 AND 100),
  status TEXT DEFAULT 'operational' CHECK(status IN ('operational','at_capacity','offline','under_repair')),
  contact_name TEXT,
  contact_phone TEXT,
  operating_hours TEXT,
  accepts_waste_types JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gatherers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  alt_phone TEXT,
  district TEXT NOT NULL,
  service_communities TEXT[],
  vehicle_type TEXT DEFAULT 'tricycle' CHECK(vehicle_type IN ('tricycle','motorbike','handcart','truck','bicycle','on_foot','other')),
  current_lat DOUBLE PRECISION,
  current_lon DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  is_available BOOLEAN DEFAULT true,
  waste_types TEXT[] DEFAULT ARRAY['general'],
  bio_certified BOOLEAN DEFAULT false,
  ngo_id UUID,
  rating DOUBLE PRECISION DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
  total_collections INTEGER DEFAULT 0,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ngos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  acronym TEXT,
  org_type TEXT NOT NULL CHECK(org_type IN ('ngo','government_agency','un_body','faith_org','community_org','private_company','other')),
  focus_areas TEXT[] NOT NULL,
  service_districts TEXT[] NOT NULL,
  description TEXT,
  contact_person TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_email TEXT,
  website TEXT,
  address TEXT,
  district TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  ai_contactable BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ngo_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  district TEXT,
  service_communities TEXT[],
  is_active BOOLEAN DEFAULT true,
  receives_ai_alerts BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS illegal_dump_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district TEXT NOT NULL,
  community TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  severity TEXT DEFAULT 'moderate' CHECK(severity IN ('low','moderate','high','critical')),
  waste_types TEXT[],
  estimated_volume_m3 DOUBLE PRECISION,
  photo_url TEXT,
  description TEXT,
  reporter_name TEXT,
  reporter_phone TEXT,
  reported_by UUID REFERENCES users(id),
  status TEXT DEFAULT 'open' CHECK(status IN ('open','assigned','in_cleanup','resolved')),
  assigned_ngo_id UUID REFERENCES ngos(id),
  assigned_gatherer_id UUID REFERENCES gatherers(id),
  resolved_at TIMESTAMPTZ,
  ai_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  sms_message TEXT,
  broadcast_type TEXT NOT NULL CHECK(broadcast_type IN ('weather_warning','flood_risk','health_advisory','maintenance_notice','evacuation','general_info')),
  target_districts TEXT[],
  target_communities TEXT[],
  target_audience TEXT[] DEFAULT ARRAY['all'],
  severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','danger','critical')),
  generated_by TEXT DEFAULT 'ai' CHECK(generated_by IN ('ai','manual','cron')),
  created_by UUID REFERENCES users(id),
  ai_context JSONB,
  total_recipients INTEGER DEFAULT 0,
  sent_sms INTEGER DEFAULT 0,
  delivered_socket INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','failed')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK(recipient_type IN ('toilet_owner','ngo_agent','gatherer','registered_user','community_member')),
  recipient_ref_id UUID,
  name TEXT NOT NULL,
  phone TEXT,
  district TEXT,
  community TEXT,
  sms_status TEXT DEFAULT 'pending' CHECK(sms_status IN ('pending','sent','delivered','failed','skipped')),
  socket_delivered BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weather_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  temperature_c DOUBLE PRECISION,
  precipitation_mm DOUBLE PRECISION DEFAULT 0,
  humidity_pct DOUBLE PRECISION,
  windspeed_kmh DOUBLE PRECISION,
  max_precip_rate_mm DOUBLE PRECISION,
  total_precip_24h DOUBLE PRECISION,
  hourly_precip JSONB,
  raw_api_data JSONB,
  season TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  source TEXT DEFAULT 'open_meteo',
  cron_run BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS news_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline TEXT NOT NULL,
  summary TEXT,
  full_content TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  categories TEXT[],
  districts_mentioned TEXT[],
  relevance_score INTEGER DEFAULT 0 CHECK(relevance_score BETWEEN 0 AND 100),
  ai_summary TEXT,
  ai_tags TEXT[],
  is_flood_related BOOLEAN DEFAULT false,
  is_sanitation_related BOOLEAN DEFAULT false,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district TEXT NOT NULL,
  community TEXT,
  score DOUBLE PRECISION NOT NULL CHECK(score BETWEEN 0 AND 100),
  components JSONB NOT NULL,
  toilet_count INTEGER DEFAULT 0,
  avg_fill_level DOUBLE PRECISION DEFAULT 0,
  active_alerts INTEGER DEFAULT 0,
  open_dump_sites INTEGER DEFAULT 0,
  flood_risk_avg DOUBLE PRECISION DEFAULT 0,
  od_reports_24h INTEGER DEFAULT 0,
  ai_narrative TEXT,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS od_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district TEXT NOT NULL,
  community TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  near_school BOOLEAN DEFAULT false,
  school_name TEXT,
  distance_to_school_m DOUBLE PRECISION,
  reported_by UUID REFERENCES users(id),
  reporter_name TEXT,
  reporter_phone TEXT,
  photo_url TEXT,
  description TEXT,
  severity TEXT DEFAULT 'moderate' CHECK(severity IN ('low','moderate','high','critical')),
  status TEXT DEFAULT 'open' CHECK(status IN ('open','flagged','resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_sanitation_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name TEXT NOT NULL,
  district TEXT NOT NULL,
  community TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  student_count INTEGER NOT NULL,
  girl_count INTEGER,
  boy_count INTEGER,
  total_toilets INTEGER DEFAULT 0,
  girl_toilets INTEGER DEFAULT 0,
  boy_toilets INTEGER DEFAULT 0,
  has_handwashing BOOLEAN DEFAULT false,
  has_menstrual_hygiene BOOLEAN DEFAULT false,
  meets_unicef_standard BOOLEAN DEFAULT false,
  sanitation_unit_id UUID REFERENCES sanitation_units(id),
  health_score DOUBLE PRECISION DEFAULT 0 CHECK(health_score BETWEEN 0 AND 100),
  last_assessed TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK gatherers → ngos (safe to run multiple times)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_gatherers_ngo'
  ) THEN
    ALTER TABLE gatherers ADD CONSTRAINT fk_gatherers_ngo
      FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE SET NULL;
  END IF;
END $$;

-- V2 Indexes
CREATE INDEX IF NOT EXISTS idx_reg_toilets_district ON registered_toilets(district);
CREATE INDEX IF NOT EXISTS idx_waste_facilities_district ON waste_facilities(district);
CREATE INDEX IF NOT EXISTS idx_gatherers_district ON gatherers(district);
CREATE INDEX IF NOT EXISTS idx_gatherers_active ON gatherers(is_active, is_available);
CREATE INDEX IF NOT EXISTS idx_ngos_active ON ngos(is_active);
CREATE INDEX IF NOT EXISTS idx_ngo_agents_ngo ON ngo_agents(ngo_id);
CREATE INDEX IF NOT EXISTS idx_dump_sites_district ON illegal_dump_sites(district);
CREATE INDEX IF NOT EXISTS idx_dump_sites_status ON illegal_dump_sites(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_bid ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_weather_history_district ON weather_history(district, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_flood ON news_articles(is_flood_related);
CREATE INDEX IF NOT EXISTS idx_health_scores_district ON community_health_scores(district, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_od_events_district ON od_events(district);
CREATE INDEX IF NOT EXISTS idx_od_near_school ON od_events(near_school);
CREATE INDEX IF NOT EXISTS idx_school_metrics_district ON school_sanitation_metrics(district);

-- ── V3: Community Watch + Blog ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS society_watch_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type      VARCHAR(50) NOT NULL, -- toilet_condition, illegal_dump, od_event, flood_risk, sanitation_issue
  description      TEXT,
  severity         VARCHAR(20) DEFAULT 'moderate',
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),
  district         VARCHAR(100),
  community        VARCHAR(150),
  location_name    TEXT,
  photo_url        TEXT,
  cloudinary_id    TEXT,
  reporter_name    VARCHAR(150),
  reporter_phone   VARCHAR(30),
  device_info      TEXT,
  geocode_data     JSONB,
  routed_to        VARCHAR(50),   -- which model it was saved to: toilet, dump, od_event, report
  routed_id        UUID,          -- the id of the created record
  ai_tags          TEXT[],
  status           VARCHAR(20) DEFAULT 'received',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_society_watch_district ON society_watch_reports(district);
CREATE INDEX IF NOT EXISTS idx_society_watch_type ON society_watch_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_society_watch_created ON society_watch_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS blog_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(255) NOT NULL,
  slug             VARCHAR(310) UNIQUE,
  summary          TEXT,
  content          TEXT NOT NULL,
  cover_image_url  TEXT,
  cover_cloudinary_id TEXT,
  author_type      VARCHAR(30) DEFAULT 'admin',   -- admin, ngo, ai
  author_id        UUID,
  author_name      VARCHAR(150),
  district         VARCHAR(100),
  tags             TEXT[] DEFAULT '{}',
  status           VARCHAR(20) DEFAULT 'draft',   -- draft, published, archived
  published_at     TIMESTAMPTZ,
  view_count       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_published ON blog_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_author ON blog_posts(author_type, author_id);

-- ── V4: Climate-Resilient Features ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sludge_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  toilet_id             UUID REFERENCES registered_toilets(id) ON DELETE SET NULL,
  gatherer_id           UUID REFERENCES gatherers(id) ON DELETE SET NULL,
  facility_id           UUID REFERENCES waste_facilities(id) ON DELETE SET NULL,
  district              TEXT NOT NULL,
  community             TEXT,
  status                TEXT DEFAULT 'pending' CHECK(status IN ('pending','assigned','accepted','in_transit','delivered','completed','cancelled')),
  volume_litres         DOUBLE PRECISION,
  waste_type            TEXT DEFAULT 'fecal_sludge' CHECK(waste_type IN ('fecal_sludge','greywater','solid_waste','mixed')),
  pickup_lat            DOUBLE PRECISION,
  pickup_lon            DOUBLE PRECISION,
  pickup_at             TIMESTAMPTZ,
  pickup_photo_url      TEXT,
  pickup_cloudinary_id  TEXT,
  delivery_lat          DOUBLE PRECISION,
  delivery_lon          DOUBLE PRECISION,
  delivered_at          TIMESTAMPTZ,
  delivery_photo_url    TEXT,
  delivery_cloudinary_id TEXT,
  treatment_confirmed_at TIMESTAMPTZ,
  treatment_notes       TEXT,
  chain_complete        BOOLEAN DEFAULT false,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sludge_jobs_district ON sludge_jobs(district);
CREATE INDEX IF NOT EXISTS idx_sludge_jobs_status ON sludge_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sludge_jobs_gatherer ON sludge_jobs(gatherer_id);

CREATE TABLE IF NOT EXISTS flood_assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district              TEXT NOT NULL,
  trigger_type          TEXT DEFAULT 'auto' CHECK(trigger_type IN ('auto','manual')),
  trigger_rainfall_mm   DOUBLE PRECISION,
  trigger_threshold_mm  DOUBLE PRECISION DEFAULT 25,
  status                TEXT DEFAULT 'active' CHECK(status IN ('active','recovery','completed')),
  total_assets_flagged  INTEGER DEFAULT 0,
  assets_inspected      INTEGER DEFAULT 0,
  assets_damaged        INTEGER DEFAULT 0,
  assets_destroyed      INTEGER DEFAULT 0,
  recovery_checklist    JSONB,
  ai_assessment         TEXT,
  notifications_sent    BOOLEAN DEFAULT false,
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_assessments_district ON flood_assessments(district);
CREATE INDEX IF NOT EXISTS idx_flood_assessments_status ON flood_assessments(status);

CREATE TABLE IF NOT EXISTS asset_flood_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   UUID NOT NULL REFERENCES flood_assessments(id) ON DELETE CASCADE,
  asset_type      TEXT NOT NULL CHECK(asset_type IN ('toilet','sanitation_unit','facility')),
  asset_id        UUID NOT NULL,
  asset_name      TEXT,
  district        TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','ok','damaged','destroyed')),
  damage_level    TEXT DEFAULT 'none' CHECK(damage_level IN ('none','minor','major','destroyed')),
  notes           TEXT,
  photo_url       TEXT,
  cloudinary_id   TEXT,
  inspected_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  inspected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asset_flood_checks_assessment ON asset_flood_checks(assessment_id);
CREATE INDEX IF NOT EXISTS idx_asset_flood_checks_status ON asset_flood_checks(status);

-- MHM fields for school_sanitation_metrics
ALTER TABLE school_sanitation_metrics ADD COLUMN IF NOT EXISTS mhm_room_count INTEGER DEFAULT 0;
ALTER TABLE school_sanitation_metrics ADD COLUMN IF NOT EXISTS mhm_has_water BOOLEAN DEFAULT false;
ALTER TABLE school_sanitation_metrics ADD COLUMN IF NOT EXISTS mhm_has_disposal BOOLEAN DEFAULT false;
ALTER TABLE school_sanitation_metrics ADD COLUMN IF NOT EXISTS mhm_is_functional BOOLEAN DEFAULT false;
ALTER TABLE school_sanitation_metrics ADD COLUMN IF NOT EXISTS mhm_notes TEXT;

-- Vulnerability scores
ALTER TABLE registered_toilets ADD COLUMN IF NOT EXISTS vulnerability_score INTEGER DEFAULT 0;
ALTER TABLE registered_toilets ADD COLUMN IF NOT EXISTS vulnerability_factors JSONB;
ALTER TABLE registered_toilets ADD COLUMN IF NOT EXISTS flood_check_status VARCHAR(20);

ALTER TABLE sanitation_units ADD COLUMN IF NOT EXISTS vulnerability_score INTEGER DEFAULT 0;
ALTER TABLE sanitation_units ADD COLUMN IF NOT EXISTS vulnerability_factors JSONB;

-- Location discovery tracking
ALTER TABLE registered_toilets ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE registered_toilets ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE waste_facilities    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE waste_facilities    ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE TABLE IF NOT EXISTS discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'overpass+google_places',
  toilets_found INTEGER DEFAULT 0,
  toilets_saved INTEGER DEFAULT 0,
  facilities_found INTEGER DEFAULT 0,
  facilities_saved INTEGER DEFAULT 0,
  districts_covered TEXT[],
  duration_ms INTEGER,
  error TEXT
);

-- AI post-processing columns for news_articles
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS ai_sentiment VARCHAR(20) DEFAULT 'neutral';
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS ai_districts TEXT[];
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS ai_event_type VARCHAR(50);
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_news_ai_processed ON news_articles(ai_processed);
