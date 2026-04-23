-- 20260423000005_tournament_courts.sql
--
-- `tournament_courts` — per-tournament court display order.
--
-- Captures the left-to-right column order of courts on FIP's Order of Play
-- page so the fan-visible match lists can render matches in the same order
-- users see on the official tournament pages (Brussels P2: CBC → Nextensa →
-- Lotto, etc.). Populated by padelgod's `oop-fetcher` worker on each OOP
-- parse (every 2h); see `padelgod/src/workers/oop-fetcher.ts` for the
-- upsert logic and `padelgod/src/parsers/crionet-oop.ts` for where the
-- order comes from (DOM index of `div.col-lg-4` columns).
--
-- Why a side table instead of a column on `matches`:
--   - Display order is a property of the tournament venue, not the match
--   - 3-6 rows per tournament vs. 300+ matches — normalized storage
--   - OOP scraping can't always match the exact court name we have on
--     `matches.court` (case/whitespace/synonyms); keeping the canonical
--     spelling here lets consumers do a case-insensitive join
--
-- Fallback when no row exists (Premier Padel tournaments, or OOP not yet
-- parsed): consumers should sort by `matches.court` alphabetically, then
-- `matches.court_order`.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tournament_courts (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  -- Court name AS IT APPEARS in the OOP page. Preserved verbatim so we
  -- can join case-insensitively with `matches.court` without ambiguity.
  court_name TEXT NOT NULL,
  -- 0-based display order. Lower = shown more prominently (usually the
  -- show court / center court). Upserts preserve the most recent value
  -- from the latest OOP parse.
  display_order INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, court_name)
);

-- Fast lookup pattern: "give me every court for this tournament in order"
CREATE INDEX IF NOT EXISTS tournament_courts_lookup_idx
  ON public.tournament_courts (tournament_id, display_order);

COMMIT;
