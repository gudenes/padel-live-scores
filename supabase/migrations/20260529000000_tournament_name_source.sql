-- Add tournaments.name_source to track manual name overrides.
--
-- Background: tournament names are written unconditionally by two automated
-- writers — padelgod's tournament-discovery worker (FIP WP API, hourly) and
-- the padelapi sync cron. An operator who hand-corrects a name via the ops
-- dashboard would have their edit clobbered on the next run.
--
-- name_source records provenance. The ops "edit name" endpoint sets it to
-- 'manual'; both automated writers preserve the existing name when
-- name_source = 'manual'. Null (the default) means "auto-owned" — automated
-- sources are free to overwrite, which lets existing rows self-heal once the
-- HTML-entity decode fix lands in the WP-events parser.
--
-- Mirrors the prize_money_eur_source provenance pattern.

BEGIN;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS name_source TEXT;

COMMENT ON COLUMN public.tournaments.name_source IS
  'Provenance of tournaments.name. ''manual'' = operator-edited via ops dashboard; automated writers (padelgod discovery, padelapi sync) must not overwrite. NULL = auto-owned (default).';

COMMIT;
