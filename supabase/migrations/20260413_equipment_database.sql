-- Padel Equipment Database
-- 4 tables: padel_brands, padel_rackets, player_equipment, racket_clicks

-- Brands
CREATE TABLE IF NOT EXISTS padel_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  website_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rackets
CREATE TABLE IF NOT EXISTS padel_rackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES padel_brands(id),
  model TEXT NOT NULL,
  year INTEGER,
  shape TEXT,
  weight_grams INTEGER,
  balance TEXT,
  surface_material TEXT,
  image_url TEXT,
  product_url TEXT,
  click_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (brand_id, model, year)
);

-- Player equipment history
CREATE TABLE IF NOT EXISTS player_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  racket_id UUID NOT NULL REFERENCES padel_rackets(id) ON DELETE CASCADE,
  started_at DATE,
  ended_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, racket_id, started_at)
);

CREATE INDEX IF NOT EXISTS idx_player_equipment_current
  ON player_equipment (player_id) WHERE ended_at IS NULL;

-- Affiliate click tracking
CREATE TABLE IF NOT EXISTS racket_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  racket_id UUID NOT NULL REFERENCES padel_rackets(id),
  player_id UUID REFERENCES players(id),
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_racket_clicks_racket ON racket_clicks (racket_id);
CREATE INDEX IF NOT EXISTS idx_racket_clicks_player ON racket_clicks (player_id);

-- Enable RLS
ALTER TABLE padel_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE padel_rackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE racket_clicks ENABLE ROW LEVEL SECURITY;

-- Public read for all equipment tables
CREATE POLICY "Public read brands" ON padel_brands FOR SELECT USING (true);
CREATE POLICY "Public read rackets" ON padel_rackets FOR SELECT USING (true);
CREATE POLICY "Public read player_equipment" ON player_equipment FOR SELECT USING (true);

-- Anyone can insert clicks (tracked for analytics)
CREATE POLICY "Insert clicks" ON racket_clicks FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read clicks" ON racket_clicks FOR SELECT USING (true);
