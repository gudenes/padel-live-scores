-- Geo-aware Where-to-Watch: per-channel, per-country live-stream block rules.

CREATE TABLE IF NOT EXISTS channel_region_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  country_iso2  TEXT NOT NULL,
  effect        TEXT NOT NULL DEFAULT 'block' CHECK (effect IN ('block','allow')),
  source        TEXT NOT NULL CHECK (source IN ('seed','yt_api','broadcaster','manual')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS channel_region_rules_channel_idx
  ON channel_region_rules(channel_id);

-- Runtime reads this on public pages via the anon key (like `broadcasters`).
ALTER TABLE channel_region_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_region_rules_anon_read ON channel_region_rules;
CREATE POLICY channel_region_rules_anon_read
  ON channel_region_rules FOR SELECT USING (true);

-- Observed signal for the admin suggestion panel (never authoritative).
ALTER TABLE youtube_channels
  ADD COLUMN IF NOT EXISTS observed_region_blocks JSONB,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;

-- Seed the known Disney / Latin America deal for both circuit channels.
INSERT INTO channel_region_rules (channel_id, country_iso2, effect, source, note)
SELECT c.id, x.cc, 'block', 'seed', 'Disney holds Latin America rights'
FROM youtube_channels c
CROSS JOIN (VALUES
  ('ar'),('bo'),('br'),('cl'),('co'),('cr'),('cu'),('do'),('ec'),('gt'),
  ('hn'),('mx'),('ni'),('pa'),('pe'),('pr'),('py'),('sv'),('uy'),('ve')
) AS x(cc)
WHERE c.abbreviation IN ('FIP','PP')
ON CONFLICT (channel_id, country_iso2) DO NOTHING;
