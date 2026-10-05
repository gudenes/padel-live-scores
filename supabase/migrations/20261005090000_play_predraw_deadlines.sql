-- Apply before deploying admin. Unbound editorial markets close for the whole
-- main draw; bound markets retain their existing pair-match policy.
CREATE FUNCTION public.play_guard_predraw_market() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.bound_match_id IS NULL AND NEW.match_id IS NULL AND NEW.tournament_id IS NOT NULL
 AND NEW.resolver_key IN ('tournament.pair_champion_v1','tournament.pair_reaches_round_v1','tournament.other_pair_wins_v1') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('play-draw:'||NEW.tournament_id::text||':'||NEW.category,0));
  IF EXISTS(SELECT 1 FROM matches x WHERE x.tournament_id=NEW.tournament_id AND x.category=NEW.category
   AND x.round_canonical IN ('R128','R64','R32','R16','QF','SF','F')
   AND (x.status IN ('live','on_court','finished','retired','walkover','cancelled') OR x.scheduled_at<=clock_timestamp()))
  THEN RAISE EXCEPTION 'main_draw_already_started'; END IF;
  IF EXISTS(SELECT 1 FROM matches x WHERE x.tournament_id=NEW.tournament_id AND x.category=NEW.category
   AND x.round_canonical IN ('R128','R64','R32','R16','QF','SF','F') AND x.status='scheduled' AND x.scheduled_at<NEW.locks_at)
  THEN RAISE EXCEPTION 'main_draw_schedule_changed_preview_again'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_guard_predraw_market BEFORE INSERT ON public.markets FOR EACH ROW EXECUTE FUNCTION public.play_guard_predraw_market();
CREATE FUNCTION public.play_serialize_draw_schedule() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.tournament_id IS NOT NULL AND NEW.category IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('play-draw:'||NEW.tournament_id::text||':'||NEW.category,0));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_serialize_draw_schedule BEFORE INSERT OR UPDATE OF status,scheduled_at,round_canonical,category,tournament_id ON public.matches
 FOR EACH ROW EXECUTE FUNCTION public.play_serialize_draw_schedule();
CREATE OR REPLACE FUNCTION public.play_lock_started_markets() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('live','on_court','finished','retired','walkover','cancelled') THEN
  UPDATE markets SET status='locked',locks_at=least(locks_at,clock_timestamp())
  WHERE status='open' AND (match_id=NEW.id OR bound_match_id=NEW.id OR
   (bound_match_id IS NULL AND match_id IS NULL AND tournament_id=NEW.tournament_id AND category=NEW.category
    AND resolver_key IN ('tournament.pair_champion_v1','tournament.pair_reaches_round_v1','tournament.other_pair_wins_v1')
    AND NEW.round_canonical IN ('R128','R64','R32','R16','QF','SF','F')));
 ELSIF NEW.scheduled_at IS NOT NULL THEN
  UPDATE markets SET locks_at=least(locks_at,NEW.scheduled_at)
  WHERE status='open' AND (match_id=NEW.id OR bound_match_id=NEW.id OR
   (bound_match_id IS NULL AND match_id IS NULL AND tournament_id=NEW.tournament_id AND category=NEW.category
    AND resolver_key IN ('tournament.pair_champion_v1','tournament.pair_reaches_round_v1','tournament.other_pair_wins_v1')
    AND NEW.round_canonical IN ('R128','R64','R32','R16','QF','SF','F')));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER play_lock_started_markets ON public.matches;
CREATE TRIGGER play_lock_started_markets AFTER INSERT OR UPDATE OF status,scheduled_at,round_canonical,category,tournament_id ON public.matches
 FOR EACH ROW EXECUTE FUNCTION public.play_lock_started_markets();
