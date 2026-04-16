-- Broadcasters list for a tournament.
-- Used by the match OG image + match detail page to show where viewers
-- can watch live matches (e.g. Movistar, RedBull TV, YouTube).
-- NULL = unknown / not applicable.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS broadcasters TEXT[];

COMMENT ON COLUMN tournaments.broadcasters IS
  'Broadcaster names for this tournament (e.g. [''Movistar'', ''RedBull TV'', ''YouTube'']). Populated from Premier Padel API for Premier tournaments, editable via ops dashboard.';
