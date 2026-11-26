-- Incremental materialization: one contribution per match/player; one small
-- public row per player/season. No match-history scans on page loads.
CREATE TABLE public.player_season_stats (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  matches integer NOT NULL DEFAULT 0,
  win_rate integer GENERATED ALWAYS AS (CASE WHEN matches > 0 THEN round(100.0 * wins / matches)::integer END) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id, season),
  CHECK (wins >= 0 AND matches >= wins)
);
ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public season stats" ON public.player_season_stats FOR SELECT USING (true);
GRANT SELECT ON public.player_season_stats TO anon, authenticated;
GRANT ALL ON public.player_season_stats TO service_role;

-- Private ledger makes corrections, cancellations, deletions and moves between
-- seasons reversible. No FK to matches: the AFTER DELETE trigger needs old rows.
CREATE TABLE public.player_season_contributions (
  match_id uuid NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL,
  won integer NOT NULL CHECK (won IN (0,1)),
  PRIMARY KEY(match_id, player_id)
);
ALTER TABLE public.player_season_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_season_contributions FROM anon, authenticated;

CREATE FUNCTION public.sync_player_season_match(p_match_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; previous jsonb;
BEGIN
  -- The match row is locked by its triggering write. Apply grouped deltas in
  -- deterministic player/season order; atomic increments avoid lost updates.
  SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO previous FROM public.player_season_contributions c WHERE match_id=p_match_id;
  DELETE FROM public.player_season_contributions WHERE match_id=p_match_id;
  FOR d IN
    WITH added AS (
      INSERT INTO public.player_season_contributions(match_id, player_id, season, won)
      SELECT m.id, p.id, extract(year FROM coalesce(m.scheduled_at,m.started_at,t.starts_at) AT TIME ZONE 'UTC')::integer,
             max((m.winner_pair = p.pair)::integer)
      FROM public.matches m LEFT JOIN public.tournaments t ON t.id=m.tournament_id
      CROSS JOIN LATERAL (VALUES (m.pair1_player1_id,1),(m.pair1_player2_id,1),(m.pair2_player1_id,2),(m.pair2_player2_id,2)) p(id,pair)
      WHERE m.id=p_match_id AND m.status IN ('finished','retired') AND m.winner_pair IN (1,2)
        AND p.id IS NOT NULL AND coalesce(m.scheduled_at,m.started_at,t.starts_at) IS NOT NULL
      GROUP BY m.id,p.id,t.starts_at
      RETURNING player_id,season,won
    )
    SELECT player_id,season,sum(wins)::integer AS wins,sum(played)::integer AS played
    FROM (SELECT player_id,season,-won AS wins,-1 AS played FROM jsonb_to_recordset(previous) AS old_rows(player_id uuid,season integer,won integer)
          UNION ALL SELECT player_id,season,won,1 FROM added) deltas
    GROUP BY player_id,season HAVING sum(wins)<>0 OR sum(played)<>0 ORDER BY player_id,season
  LOOP
    INSERT INTO public.player_season_stats(player_id,season) VALUES(d.player_id,d.season) ON CONFLICT DO NOTHING;
    UPDATE public.player_season_stats SET wins=wins+d.wins, matches=matches+d.played, updated_at=now()
    WHERE player_id=d.player_id AND season=d.season;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sync_player_season_match(uuid) FROM PUBLIC;

CREATE FUNCTION public.player_season_match_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.sync_player_season_match(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.player_season_match_changed() FROM PUBLIC;
CREATE TRIGGER player_season_match_insert AFTER INSERT ON public.matches FOR EACH ROW EXECUTE FUNCTION public.player_season_match_changed();
CREATE TRIGGER player_season_match_delete AFTER DELETE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.player_season_match_changed();
CREATE TRIGGER player_season_match_update AFTER UPDATE OF status,winner_pair,scheduled_at,started_at,tournament_id,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id ON public.matches
FOR EACH ROW WHEN (ROW(OLD.status,OLD.winner_pair,OLD.scheduled_at,OLD.started_at,OLD.tournament_id,OLD.pair1_player1_id,OLD.pair1_player2_id,OLD.pair2_player1_id,OLD.pair2_player2_id) IS DISTINCT FROM ROW(NEW.status,NEW.winner_pair,NEW.scheduled_at,NEW.started_at,NEW.tournament_id,NEW.pair1_player1_id,NEW.pair1_player2_id,NEW.pair2_player1_id,NEW.pair2_player2_id))
EXECUTE FUNCTION public.player_season_match_changed();

-- Only undated matches depend on the tournament date fallback.
CREATE FUNCTION public.player_season_tournament_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE mid uuid;
BEGIN
  FOR mid IN SELECT id FROM public.matches WHERE tournament_id=NEW.id AND scheduled_at IS NULL AND started_at IS NULL ORDER BY id FOR UPDATE LOOP
    PERFORM public.sync_player_season_match(mid);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.player_season_tournament_changed() FROM PUBLIC;
CREATE TRIGGER player_season_tournament_update AFTER UPDATE OF starts_at ON public.tournaments
FOR EACH ROW WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at) EXECUTE FUNCTION public.player_season_tournament_changed();

-- One-time set-based backfill; subsequent writes touch at most four players.
INSERT INTO public.player_season_contributions(match_id,player_id,season,won)
SELECT m.id,p.id,extract(year FROM coalesce(m.scheduled_at,m.started_at,t.starts_at) AT TIME ZONE 'UTC')::integer,max((m.winner_pair=p.pair)::integer)
FROM public.matches m LEFT JOIN public.tournaments t ON t.id=m.tournament_id
CROSS JOIN LATERAL (VALUES(m.pair1_player1_id,1),(m.pair1_player2_id,1),(m.pair2_player1_id,2),(m.pair2_player2_id,2)) p(id,pair)
WHERE m.status IN ('finished','retired') AND m.winner_pair IN (1,2) AND p.id IS NOT NULL AND coalesce(m.scheduled_at,m.started_at,t.starts_at) IS NOT NULL
GROUP BY m.id,p.id,t.starts_at;
INSERT INTO public.player_season_stats(player_id,season,wins,matches)
SELECT player_id,season,sum(won),count(*) FROM public.player_season_contributions GROUP BY player_id,season;
