-- supabase/migrations/20260601000000_ad_slots.sql
-- Sponsor ad-slot engagement tracking.
--   ad_clicks       : one row per sponsor click (mirrors racket_clicks)
--   ad_impressions  : daily aggregate counter per (slot, sponsor_id, date)
-- API routes write through the service key (bypasses RLS); no anon policies
-- are granted, so anon reads/writes are denied by default.

CREATE TABLE IF NOT EXISTS ad_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
  user_id UUID,
  locale TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_clicks_sponsor ON ad_clicks (sponsor_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_slot ON ad_clicks (slot);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_created ON ad_clicks (created_at);

CREATE TABLE IF NOT EXISTS ad_impressions (
  slot TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  date DATE NOT NULL DEFAULT current_date,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slot, sponsor_id, date)
);

-- Atomic upsert-increment used by /api/ads/impression.
CREATE OR REPLACE FUNCTION increment_ad_impression(p_slot TEXT, p_sponsor_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO ad_impressions (slot, sponsor_id, date, count)
  VALUES (p_slot, p_sponsor_id, current_date, 1)
  ON CONFLICT (slot, sponsor_id, date)
  DO UPDATE SET count = ad_impressions.count + 1;
$$;

ALTER TABLE ad_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_impressions ENABLE ROW LEVEL SECURITY;
