-- Padelgod Plan 3: append-only snapshot tables for static match data.
-- Reconciler workers (Plan 4+) read latest snapshots and merge into canonical tables.

-- 1. Entry list snapshots (one row per player per snapshot per tournament+category)
CREATE TABLE padelgod.entry_list_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  fip_id TEXT,                          -- nullable: amateurs may not have one
  name TEXT NOT NULL,
  country TEXT,                         -- ISO3 (ESP, ARG, ...)
  seed INT,                             -- nullable
  partner_fip_id TEXT,                  -- pair info (Padel is doubles)
  partner_name TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entry_list_snap_tournament ON padelgod.entry_list_snapshots(tournament_id, category, captured_at DESC);
CREATE INDEX idx_entry_list_snap_recent ON padelgod.entry_list_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.entry_list_snapshots IS
  'Per-tournament + per-category entry list rows. Append-only; reconciler reads latest snapshot per (tournament_id, category).';

-- 2. Draw snapshots (one row per match per snapshot)
CREATE TABLE padelgod.draw_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  draw_type TEXT NOT NULL CHECK (draw_type IN ('main_draw', 'qualifying')),
  round_label TEXT NOT NULL,            -- e.g. 'R32', 'QF', 'SF', 'F'
  draw_position INT,                    -- bracket slot, 1-indexed
  team1_player1_name TEXT,              -- short widget names (resolved to FIP IDs by reconciler)
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  team1_seed INT,
  team2_seed INT,
  team1_country TEXT,
  team2_country TEXT,
  set_scores TEXT,                      -- e.g. "6-4 4-6 6-2" if completed; NULL if scheduled
  winner_team INT CHECK (winner_team IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished', 'walkover', 'retired')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_draw_snap_tournament ON padelgod.draw_snapshots(tournament_id, category, draw_type, captured_at DESC);
CREATE INDEX idx_draw_snap_recent ON padelgod.draw_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.draw_snapshots IS
  'Per-match draw bracket entries. Append-only; reconciler dedupes by (tournament_id, category, draw_type, round_label, draw_position).';

-- 3. OOP (Order of Play) snapshots (one row per scheduled match per snapshot)
CREATE TABLE padelgod.oop_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  day_number INT NOT NULL,              -- widget day cursor: 1, 2, 3, ...
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  round_label TEXT,                     -- 'QF', 'F', etc.
  court TEXT NOT NULL,
  scheduled_label TEXT,                 -- 'Starting at 10:00 AM' / 'Followed by' (raw widget text)
  team1_player1_name TEXT,
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  match_widget_id TEXT,                 -- e.g. 'MQ012' from data-id attribute
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished', 'walkover', 'retired')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_oop_snap_tournament_day ON padelgod.oop_snapshots(tournament_id, day_number, captured_at DESC);
CREATE INDEX idx_oop_snap_recent ON padelgod.oop_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.oop_snapshots IS
  'Per-tournament + per-day order of play snapshots. Append-only; reconciler reads latest per (tournament_id, day_number).';

-- 4. Results snapshots (one row per finished match per snapshot)
CREATE TABLE padelgod.results_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  round_label TEXT,
  court TEXT,
  match_widget_id TEXT,
  team1_player1_name TEXT,
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  set_scores TEXT NOT NULL,             -- '6-4 4-6 6-2'
  winner_team INT NOT NULL CHECK (winner_team IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN ('finished', 'walkover', 'retired')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_results_snap_tournament_day ON padelgod.results_snapshots(tournament_id, day_number, captured_at DESC);
CREATE INDEX idx_results_snap_recent ON padelgod.results_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.results_snapshots IS
  'Per-tournament + per-day completed match results. Append-only; reconciler reads latest per (tournament_id, day_number).';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='entry_list_snapshots'),
    'padelgod.entry_list_snapshots missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='draw_snapshots'),
    'padelgod.draw_snapshots missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='oop_snapshots'),
    'padelgod.oop_snapshots missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='results_snapshots'),
    'padelgod.results_snapshots missing';
END $$;
