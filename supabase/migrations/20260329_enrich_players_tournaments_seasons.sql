-- ── Enrich players ──────────────────────────────────────────────────────────
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS points       integer,
  ADD COLUMN IF NOT EXISTS height       integer,
  ADD COLUMN IF NOT EXISTS birthplace   text,
  ADD COLUMN IF NOT EXISTS birthdate    date,
  ADD COLUMN IF NOT EXISTS hand         text,
  ADD COLUMN IF NOT EXISTS category     text,
  ADD COLUMN IF NOT EXISTS profile_url  text,
  ADD COLUMN IF NOT EXISTS titles       integer,
  ADD COLUMN IF NOT EXISTS finals       integer,
  ADD COLUMN IF NOT EXISTS semifinals   integer;

-- ── Enrich tournaments ──────────────────────────────────────────────────────
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS location            text,
  ADD COLUMN IF NOT EXISTS level               text,
  ADD COLUMN IF NOT EXISTS url                 text,
  ADD COLUMN IF NOT EXISTS season_external_id  integer;

-- ── Seasons table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id         integer UNIQUE NOT NULL,
  name                text NOT NULL,
  year                integer,
  status              text,
  starts_at           date,
  ends_at             date,
  tournaments_count   integer,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
