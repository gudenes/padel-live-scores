-- Padelgod foundation: raw payload storage + human-review queues.

-- 3. Raw HTML payloads (replay + debugging)
CREATE TABLE padelgod.raw_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  byte_size INT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_raw_payloads_recent     ON padelgod.raw_payloads(captured_at DESC);
CREATE INDEX idx_raw_payloads_job        ON padelgod.raw_payloads(scrape_job_id);
CREATE INDEX idx_raw_payloads_hash       ON padelgod.raw_payloads(content_hash);

COMMENT ON TABLE padelgod.raw_payloads IS
  'Raw HTTP response bodies (HTML/JSON) for debugging and replay. Daily cron purges rows >48h old.';

-- 4. Human review queue: widget short-names we couldn''t resolve
CREATE TABLE padelgod.unresolved_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  widget_short_name TEXT NOT NULL,
  partner_short_name TEXT,
  match_id UUID REFERENCES public.matches(id),
  candidate_player_ids UUID[],
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'created_new', 'ignored')),
  resolved_player_id UUID REFERENCES public.players(id),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  UNIQUE (tournament_id, widget_short_name, partner_short_name)
);
CREATE INDEX idx_unresolved_players_pending ON padelgod.unresolved_players(status, first_seen_at DESC);

COMMENT ON TABLE padelgod.unresolved_players IS
  'Widget short-names that the per-tournament dictionary + pair disambiguation could not auto-resolve. Surfaced in ops dashboard.';

-- 5. Aggregate-divergence flags (when reconstructed point counts disagree with /screen/getmatchstats totals)
CREATE TABLE padelgod.unresolved_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  reason TEXT NOT NULL CHECK (reason IN ('point_count_divergence', 'set_score_mismatch', 'parser_error', 'other')),
  details JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX idx_unresolved_matches_pending ON padelgod.unresolved_matches(status, first_seen_at DESC);
CREATE INDEX idx_unresolved_matches_match   ON padelgod.unresolved_matches(match_id);

COMMENT ON TABLE padelgod.unresolved_matches IS
  'Matches where Padelgod''s reconstructed point count diverged >5% from /screen/getmatchstats totals.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='raw_payloads'),
    'padelgod.raw_payloads missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='unresolved_players'),
    'padelgod.unresolved_players missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='unresolved_matches'),
    'padelgod.unresolved_matches missing';
END $$;