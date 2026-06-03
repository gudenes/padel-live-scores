-- supabase/migrations/20260603000000_ops_ad_banners.sql
-- Ops-managed ad banners (per-country, weighted rotation, global default) +
-- a singleton AdSense/AdMob config. Replaces the src/lib/sponsors.ts config.

CREATE TABLE IF NOT EXISTS ad_banners (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  country_code TEXT CHECK (country_code ~ '^[A-Z]{2}$'),  -- NULL = global default
  slot         TEXT NOT NULL DEFAULT 'sticky-bottom',
  image_url    TEXT NOT NULL,
  click_url    TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  weight       INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Multiple active banners may share a (slot, country); they rotate by weight.
CREATE INDEX IF NOT EXISTS idx_ad_banners_active ON ad_banners (slot) WHERE active;

ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;  -- service-key only

CREATE TABLE IF NOT EXISTS ad_network_config (
  key                  TEXT PRIMARY KEY DEFAULT 'default' CHECK (key = 'default'),
  web_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  adsense_publisher_id TEXT,
  adsense_slot_id      TEXT,
  native_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  admob_ios_app_id     TEXT,
  admob_android_app_id TEXT,
  admob_banner_unit_id TEXT,
  updated_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE ad_network_config ENABLE ROW LEVEL SECURITY;  -- service-key only
INSERT INTO ad_network_config (key) VALUES ('default') ON CONFLICT DO NOTHING;

-- Storage bucket for uploaded banner creatives (public read).
INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-banners', 'ad-banners', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read ad-banners" ON storage.objects;
CREATE POLICY "Public read ad-banners" ON storage.objects
  FOR SELECT USING (bucket_id = 'ad-banners');

-- Seed the current placeholder so nothing disappears when the code config goes.
INSERT INTO ad_banners (name, country_code, slot, image_url, click_url, active)
VALUES ('AceProGrip', 'ES', 'sticky-bottom',
        '/sponsors/aceprogrip-banner.svg', 'https://www.aceprogrip.es/', TRUE)
ON CONFLICT DO NOTHING;
