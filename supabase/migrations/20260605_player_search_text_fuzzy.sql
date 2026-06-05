-- Smart player search: accent / nickname / abbreviation / typo tolerant.
-- See docs/superpowers/specs/2026-06-05-smart-player-search-design.md

-- 1. Trigram fuzzy matching (unaccent already installed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Curated, search-only nicknames (raw form; normalized into search_text).
ALTER TABLE players ADD COLUMN IF NOT EXISTS nicknames text[] NOT NULL DEFAULT '{}';

-- 3. Denormalized search haystack: name + display_name + nicknames, normalized
--    with the SAME formula as normalized_name (unaccent, fold punctuation to
--    spaces, collapse whitespace, lowercase, trim).
ALTER TABLE players ADD COLUMN IF NOT EXISTS search_text text;

CREATE OR REPLACE FUNCTION compute_player_search_text(p_name text, p_display text, p_nicks text[])
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT trim(both ' ' FROM lower(
    regexp_replace(
      regexp_replace(
        unaccent(
          coalesce(p_name, '') || ' ' ||
          coalesce(p_display, '') || ' ' ||
          array_to_string(coalesce(p_nicks, '{}'::text[]), ' ')
        ),
        '[^a-zA-Z0-9 ]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  ));
$$;

-- 4. Trigger keeps search_text in sync. normalized_name is left untouched.
CREATE OR REPLACE FUNCTION set_player_search_text()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := compute_player_search_text(NEW.name, NEW.display_name, NEW.nicknames);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_player_search_text ON players;
CREATE TRIGGER trg_player_search_text
  BEFORE INSERT OR UPDATE OF name, display_name, nicknames ON players
  FOR EACH ROW EXECUTE FUNCTION set_player_search_text();

-- 5. Backfill existing rows.
UPDATE players SET search_text = compute_player_search_text(name, display_name, nicknames);

-- 6. GIN trigram index — accelerates both LIKE '%q%' and similarity().
CREATE INDEX IF NOT EXISTS idx_players_search_text_trgm
  ON players USING gin (search_text gin_trgm_ops);

-- 7. Ranked search RPC. Conservative fuzzy: strict_word_similarity >= 0.45
--    (word-boundary aware, so a short typo matches the closest NAME WORD rather
--    than being diluted by the whole full-name string — plain similarity()
--    scored "cohello" vs "arturo coello" at only 0.29). exact/substring always
--    outrank fuzzy. Casts pin RETURNS TABLE types regardless of column types.
CREATE OR REPLACE FUNCTION search_players(q text, max_results int DEFAULT 12)
RETURNS TABLE (
  id uuid, name text, display_name text, country text,
  ranking int, category text, avatar_url text
)
LANGUAGE sql STABLE AS $$
  WITH params AS (
    SELECT trim(both ' ' FROM lower(
      regexp_replace(
        regexp_replace(unaccent(coalesce(q, '')), '[^a-zA-Z0-9 ]', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    )) AS nq
  )
  SELECT p.id, p.name::text, p.display_name::text, p.country::text,
         p.ranking::int, p.category::text, p.avatar_url::text
  FROM players p, params
  WHERE params.nq <> ''
    AND (
      p.search_text LIKE '%' || params.nq || '%'
      OR (length(params.nq) >= 3 AND strict_word_similarity(params.nq, p.search_text) >= 0.45)
    )
  ORDER BY
    (CASE
       WHEN p.search_text LIKE params.nq || '%' THEN 3
       WHEN p.search_text LIKE '%' || params.nq || '%' THEN 2
       ELSE 1
     END) DESC,
    p.ranking ASC NULLS LAST,
    strict_word_similarity(params.nq, p.search_text) DESC
  LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION search_players(text, int) TO anon, authenticated;

-- 8. Curated nickname seed — search-only aliases NOT already captured by name
--    or display_name. (Many common nicknames — Momo, Sanyo, Ari, Bea, Ale, Edu,
--    Maxi, Coki, Tolito, Paquito — are already display_names from
--    20260409_player_display_name.sql, so this is the genuinely-new tail.)
--    Targeted by exact name; updating nicknames re-fires the trigger to refresh
--    search_text. No-op when a name is absent. Extend with one line per player.
UPDATE players SET nicknames = ARRAY['paco']           WHERE name = 'Francisco Navarro';
UPDATE players SET nicknames = ARRAY['bela']           WHERE name = 'Fernando Belasteguin';
UPDATE players SET nicknames = ARRAY['agus','mozart']  WHERE name = 'Agustin Tapia';
UPDATE players SET nicknames = ARRAY['tincho']         WHERE name = 'Martin Di Nenno';
UPDATE players SET nicknames = ARRAY['stupa']          WHERE name = 'Franco Stupaczuk';
UPDATE players SET nicknames = ARRAY['chingo','fede']  WHERE name = 'Federico Chingotto';
UPDATE players SET nicknames = ARRAY['campa']          WHERE name = 'Lucas Campagnolo';
UPDATE players SET nicknames = ARRAY['delfi']          WHERE name = 'Delfina Brea Senesi';
UPDATE players SET nicknames = ARRAY['vicky','viki']   WHERE name = 'Victoria Iglesias Segador';
