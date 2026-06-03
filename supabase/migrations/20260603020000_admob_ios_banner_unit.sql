-- supabase/migrations/20260603020000_admob_ios_banner_unit.sql
-- Per-platform AdMob banner units: iOS and Android have different ad-unit IDs.
-- ad_network_config.admob_banner_unit_id holds the ANDROID unit; add iOS.
ALTER TABLE ad_network_config ADD COLUMN IF NOT EXISTS admob_ios_banner_unit_id TEXT;
