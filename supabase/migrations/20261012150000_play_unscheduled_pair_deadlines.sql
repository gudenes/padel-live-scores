-- Allow an explicit deadline for verified tournament pairs before their next match receives a time.
CREATE OR REPLACE FUNCTION public.play_guard_market_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE lim market_limits%ROWTYPE; owner_tournament uuid; daily_start timestamptz; bound_match matches%ROWTYPE;
BEGIN
 SELECT * INTO STRICT lim FROM market_limits WHERE id=true FOR UPDATE;
 daily_start := date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 IF NEW.status<>'open' OR NEW.locks_at<=clock_timestamp() THEN RAISE EXCEPTION 'market_requires_future_close'; END IF;
 IF NOT EXISTS(SELECT 1 FROM market_seasons WHERE id=NEW.season_id AND status='active' AND starts_at<=clock_timestamp() AND ends_at>NEW.locks_at)
 THEN RAISE EXCEPTION 'no_active_season_for_window'; END IF;
 IF EXISTS(SELECT 1 FROM markets m WHERE m.season_id=NEW.season_id AND
   play_market_identity(m.resolver_key,m.resolver_params,m.match_id,m.tournament_id,m.editorial_scope)=
   play_market_identity(NEW.resolver_key,NEW.resolver_params,NEW.match_id,NEW.tournament_id,NEW.editorial_scope)
   AND m.lineup_fingerprint IS NOT DISTINCT FROM NEW.lineup_fingerprint)
 THEN RAISE EXCEPTION 'duplicate_market' USING ERRCODE='23505'; END IF;
 IF (SELECT count(*) FROM markets WHERE status='open')>=lim.max_open_markets THEN RAISE EXCEPTION 'open_market_limit'; END IF;
 IF (SELECT count(*) FROM markets WHERE created_at>=daily_start)>=lim.max_new_per_day THEN RAISE EXCEPTION 'daily_market_limit'; END IF;
 IF round(coalesce((SELECT sum(lmsr_b*ln(2::numeric)) FROM markets WHERE created_at>=daily_start),0)+NEW.lmsr_b*ln(2::numeric))>lim.max_subsidy_per_day THEN RAISE EXCEPTION 'daily_subsidy_limit'; END IF;
 IF NEW.match_id IS NOT NULL AND (SELECT count(*) FROM markets WHERE match_id=NEW.match_id AND season_id=NEW.season_id AND status<>'void')>=lim.max_per_match THEN RAISE EXCEPTION 'match_market_limit'; END IF;
 owner_tournament := coalesce(NEW.tournament_id,(SELECT tournament_id FROM matches WHERE id=NEW.match_id));
 IF owner_tournament IS NOT NULL AND (SELECT count(*) FROM markets m LEFT JOIN matches x ON x.id=m.match_id
   WHERE m.created_at>=daily_start AND coalesce(m.tournament_id,x.tournament_id)=owner_tournament)>=lim.max_per_tournament_day
 THEN RAISE EXCEPTION 'tournament_daily_limit'; END IF;
 IF coalesce(NEW.bound_match_id,NEW.match_id) IS NOT NULL THEN
  -- Serialize publication with match updates: a start or earlier schedule
  -- either rejects this insert or locks the newly created market afterwards.
  SELECT * INTO bound_match FROM matches
   WHERE id=coalesce(NEW.bound_match_id,NEW.match_id) FOR UPDATE;
  IF NOT FOUND OR bound_match.status<>'scheduled' THEN
   RAISE EXCEPTION 'match_already_started_or_rescheduled';
  END IF;
  IF bound_match.scheduled_at IS NULL THEN
   IF NEW.match_id IS NOT NULL OR NEW.bound_match_id IS NULL
    OR NEW.resolver_key NOT IN ('tournament.pair_champion_v1','tournament.pair_reaches_round_v1','tournament.other_pair_wins_v1')
    OR bound_match.tournament_id IS DISTINCT FROM NEW.tournament_id
    OR bound_match.category IS DISTINCT FROM NEW.category
    OR bound_match.round_canonical IS NULL
    OR bound_match.round_canonical NOT IN ('R128','R64','R32','R16','QF','SF','F')
    OR NOT coalesce(
     (bound_match.pair1_player1_id::text=NEW.resolver_params->>'player1Id' AND bound_match.pair1_player2_id::text=NEW.resolver_params->>'player2Id')
     OR (bound_match.pair1_player2_id::text=NEW.resolver_params->>'player1Id' AND bound_match.pair1_player1_id::text=NEW.resolver_params->>'player2Id')
     OR (bound_match.pair2_player1_id::text=NEW.resolver_params->>'player1Id' AND bound_match.pair2_player2_id::text=NEW.resolver_params->>'player2Id')
     OR (bound_match.pair2_player2_id::text=NEW.resolver_params->>'player1Id' AND bound_match.pair2_player1_id::text=NEW.resolver_params->>'player2Id'),false)
   THEN RAISE EXCEPTION 'unscheduled_market_requires_verified_pair_match'; END IF;
  ELSIF bound_match.scheduled_at<NEW.locks_at OR bound_match.scheduled_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'match_already_started_or_rescheduled';
  END IF;
 END IF;
 NEW.question_snapshot := coalesce(NEW.question_snapshot,(SELECT question_i18n FROM market_templates WHERE id=NEW.template_id));
 RETURN NEW;
END $$;
