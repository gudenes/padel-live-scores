-- supabase/migrations/20260509_road_to_olympics_subscribers_richer.sql
-- Optional richer fields on the IOC-alerts subscriber list. The signup
-- form on /road-to-olympics is now the only support-action CTA (the pledge
-- concept was removed in the same change), and it collects optional
-- display_name + country alongside the required email.
--
-- Both fields are nullable — fans can subscribe with email only.

ALTER TABLE road_to_olympics_subscribers
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT;
