-- 20260923140000_league_ties_tie_key.sql
-- Corrects the uniqueness key on public.league_ties.
--
-- The original design (20260922120000) keyed a tie on
-- (tournament_id, session_number, stage), via two partial unique indexes to
-- cope with session_number being NULL on podium ties.
--
-- That key is WRONG, and the first real import proved it. In the Pro Padel
-- League several different franchise pairings play in the same session, so
-- (stage, session) does not identify a tie — it identifies a time slot. The
-- import collapsed 52 distinct ties into 20 rows and hung matches from
-- unrelated pairings off the same tie.
--
-- It was also unusable from PostgREST: inferring a PARTIAL unique index in
-- ON CONFLICT requires `ON CONFLICT (cols) WHERE <predicate>`, and the
-- `onConflict` query parameter cannot express a predicate. Every upsert
-- failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- Replaced by a single non-null natural key composed by the writer:
--     tie_key = '<stage>|<session_number or empty>|<homeSlug>|<awaySlug>'
-- No NULLs, so a plain UNIQUE works, PostgREST can target it, and it
-- identifies the confrontation rather than the slot it was played in.

alter table public.league_ties
  add column if not exists tie_key text;

comment on column public.league_ties.tie_key is
  'Natural key for the confrontation: "<stage>|<session_number or empty>|<home source slug>|<away source slug>". Built by the importer. Non-null so a plain UNIQUE (tournament_id, tie_key) works and PostgREST can upsert on it.';

-- The old key was wrong, not merely inconvenient — drop both partial indexes.
drop index if exists public.league_ties_session_key;
drop index if exists public.league_ties_stage_key;

create unique index if not exists league_ties_tie_key_idx
  on public.league_ties (tournament_id, tie_key);
