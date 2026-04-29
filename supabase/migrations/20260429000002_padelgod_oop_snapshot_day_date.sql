-- Day-pill date capture for padelgod.oop_snapshots.
--
-- Crionet's OOP widget renders a sticky day selector at the top of the
-- HTML with one `<a>…<span class="play-day-date">APR 29</span>…</a>` per
-- play day. This is the authoritative source of "Day N → calendar date"
-- for any tournament with an OOP page — independent of
-- `tournaments.starts_at`, which can drift (FIP edits the page,
-- padelapi differs, manual ops nudge a duplicate row).
--
-- The Tournament Explorer's day-pill labels currently fall back to
-- `starts_at + (dayNumber - 1) days` when no public.matches row carries
-- a `scheduled_at` for that day. That fallback was 2 days off for
-- FIP Silver Calzada (DB starts_at = Apr 27, real day-1 = Apr 29) and
-- the same for Leiria. Storing the widget's own date label per snapshot
-- row eliminates the dependency on starts_at entirely.
--
-- Nullable: pre-existing rows stay NULL until the next OOP fetch
-- overwrites them. UI continues to fall back to starts_at offset for
-- those rows, same as today.

ALTER TABLE padelgod.oop_snapshots
  ADD COLUMN IF NOT EXISTS day_date DATE;

COMMENT ON COLUMN padelgod.oop_snapshots.day_date IS
  'Calendar date (UTC) parsed from the active day-pill in the Crionet '
  'OOP widget HTML — e.g. "APR 29" → 2026-04-29. Authoritative source '
  'for the Day N → date mapping in the Tournament Explorer; supersedes '
  'the legacy starts_at + (dayNumber - 1) fallback when present.';
