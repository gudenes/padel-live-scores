-- Money leaderboard: per-player YTD prize-money aggregation for /rankings.
-- Reads public.player_tournament_earnings (public-read RLS) joined to players.
-- Server-side SUM+COUNT+ORDER+LIMIT keeps the response well under the 10k
-- PostgREST cap a full season could otherwise approach.

CREATE OR REPLACE FUNCTION public.money_leaderboard(
  p_category text,
  p_year     int,
  p_limit    int DEFAULT 500
)
RETURNS TABLE (
  player_id    uuid,
  name         text,
  display_name text,
  country      text,
  avatar_url   text,
  total_eur    bigint,
  event_count  int
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.player_id,
    p.name,
    p.display_name,
    p.country,
    p.avatar_url,
    SUM(e.per_player_eur)::bigint AS total_eur,
    COUNT(*)::int                 AS event_count
  FROM public.player_tournament_earnings e
  JOIN public.players p ON p.id = e.player_id
  WHERE e.category = p_category
    AND date_part('year', e.earned_at) = p_year
  GROUP BY e.player_id, p.name, p.display_name, p.country, p.avatar_url
  ORDER BY total_eur DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.money_leaderboard(text, int, int) TO anon, authenticated;
