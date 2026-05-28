-- supabase/migrations/20260528_racket_partner_links.sql
-- Brazil racket partner redirect (Toro Doro).
-- Country-keyed partners with per-racket URL overrides.

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  country_code TEXT NOT NULL,           -- ISO alpha-2, e.g. 'BR'
  fallback_url TEXT NOT NULL,           -- homepage when no per-racket override
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one active partner per country at a time.
CREATE UNIQUE INDEX IF NOT EXISTS partners_active_country_uniq
  ON partners (country_code) WHERE active;

CREATE TABLE IF NOT EXISTS racket_partner_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  racket_id UUID NOT NULL REFERENCES padel_rackets(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (racket_id, partner_id)
);

CREATE INDEX IF NOT EXISTS racket_partner_links_partner_idx
  ON racket_partner_links (partner_id);

-- Click attribution columns (additive — no migration of existing rows).
ALTER TABLE racket_clicks ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE racket_clicks ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
ALTER TABLE racket_clicks ADD COLUMN IF NOT EXISTS resolved_url TEXT;

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE racket_partner_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read partners" ON partners FOR SELECT USING (true);
CREATE POLICY "Public read racket_partner_links" ON racket_partner_links FOR SELECT USING (true);
