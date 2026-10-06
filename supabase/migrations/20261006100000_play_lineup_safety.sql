-- Match identity is separate from its draw slot. Never carry prices or plays
-- over to replacement participants. Within-pair ordering is insignificant.
BEGIN;
CREATE FUNCTION public.play_lineup_key(a uuid,b uuid,c uuid,d uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN a IS NULL OR b IS NULL OR c IS NULL OR d IS NULL
   OR cardinality(ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[a,b,c,d]) x))<>4 THEN NULL
 ELSE least(a::text,b::text)||':'||greatest(a::text,b::text)||'|'||least(c::text,d::text)||':'||greatest(c::text,d::text) END
$$;
ALTER TABLE matches ADD COLUMN lineup_fingerprint text,
 ADD COLUMN pred_lineup_fingerprint text,
 ADD COLUMN lineup_withdrawal_confirmed boolean NOT NULL DEFAULT false,
 ADD COLUMN lineup_prediction_pending boolean NOT NULL DEFAULT false,
 ADD COLUMN lineup_market_refresh_pending boolean NOT NULL DEFAULT false;
ALTER TABLE markets ADD COLUMN lineup_fingerprint text, ADD COLUMN lineup_hold_status text, ADD COLUMN lineup_snapshot jsonb, ADD COLUMN lineup_cancelled_at timestamptz;
ALTER TABLE model_predictions ADD COLUMN lineup_fingerprint text,
 ADD COLUMN lineup_valid boolean NOT NULL DEFAULT true;
UPDATE matches SET lineup_fingerprint=play_lineup_key(pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id);
UPDATE matches SET pred_lineup_fingerprint=lineup_fingerprint WHERE pred_pair1_prob IS NOT NULL;
CREATE FUNCTION public.play_lineup_snapshot(mid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object(
   'pair1_player1_id',m.pair1_player1_id,'pair1_player2_id',m.pair1_player2_id,
   'pair2_player1_id',m.pair2_player1_id,'pair2_player2_id',m.pair2_player2_id,
   'pair1_player1', (SELECT jsonb_build_object('id',id,'name',name,'display_name',display_name,'avatar_url',avatar_url,'country',country) FROM players WHERE id=m.pair1_player1_id),
   'pair1_player2', (SELECT jsonb_build_object('id',id,'name',name,'display_name',display_name,'avatar_url',avatar_url,'country',country) FROM players WHERE id=m.pair1_player2_id),
   'pair2_player1', (SELECT jsonb_build_object('id',id,'name',name,'display_name',display_name,'avatar_url',avatar_url,'country',country) FROM players WHERE id=m.pair2_player1_id),
   'pair2_player2', (SELECT jsonb_build_object('id',id,'name',name,'display_name',display_name,'avatar_url',avatar_url,'country',country) FROM players WHERE id=m.pair2_player2_id)
 ) FROM matches m WHERE m.id=mid
$$;
UPDATE markets m SET lineup_fingerprint=x.lineup_fingerprint,lineup_snapshot=play_lineup_snapshot(x.id) FROM matches x WHERE coalesce(m.match_id,CASE WHEN m.resolver_key LIKE 'match.%' THEN m.bound_match_id END)=x.id;
UPDATE model_predictions p SET lineup_fingerprint=x.lineup_fingerprint FROM matches x WHERE p.match_id=x.id;
-- Preserve operator holds and paid history. Unknown legacy lineups fail closed.
UPDATE markets m SET status='held',lineup_hold_status=m.status,hold_reason='lineup:incomplete'
 FROM matches x WHERE coalesce(m.match_id,CASE WHEN m.resolver_key LIKE 'match.%' THEN m.bound_match_id END)=x.id AND x.lineup_fingerprint IS NULL AND m.status IN ('open','locked','proposed');
UPDATE model_predictions p SET lineup_valid=false FROM matches x WHERE p.match_id=x.id AND x.lineup_fingerprint IS NULL;
UPDATE matches SET pred_pair1_prob=NULL,pred_model_version=NULL,pred_computed_at=NULL,pred_lineup_fingerprint=NULL WHERE lineup_fingerprint IS NULL;

CREATE FUNCTION public.play_track_lineup() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE k text;
BEGIN
 k:=play_lineup_key(NEW.pair1_player1_id,NEW.pair1_player2_id,NEW.pair2_player1_id,NEW.pair2_player2_id);
 NEW.lineup_fingerprint:=k;
 IF TG_OP='INSERT' OR k IS DISTINCT FROM OLD.lineup_fingerprint THEN
   NEW.pred_pair1_prob:=NULL; NEW.pred_model_version:=NULL; NEW.pred_computed_at:=NULL;
   NEW.pred_lineup_fingerprint:=NULL;
   NEW.lineup_prediction_pending:=(k IS NOT NULL AND NEW.status='scheduled');
   NEW.lineup_market_refresh_pending:=NEW.lineup_prediction_pending;
 END IF;
 IF k IS NOT NULL THEN NEW.lineup_withdrawal_confirmed:=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_a_track_lineup BEFORE INSERT OR UPDATE OF pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id ON matches
 FOR EACH ROW EXECUTE FUNCTION play_track_lineup();

CREATE FUNCTION public.play_pause_lineup_markets() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.lineup_fingerprint IS DISTINCT FROM OLD.lineup_fingerprint OR
    NEW.lineup_withdrawal_confirmed IS DISTINCT FROM OLD.lineup_withdrawal_confirmed THEN
   UPDATE model_predictions SET lineup_valid=false WHERE match_id=NEW.id AND
     (NEW.lineup_fingerprint IS NULL OR lineup_fingerprint IS DISTINCT FROM NEW.lineup_fingerprint);
   UPDATE markets SET lineup_hold_status=CASE WHEN status='held' THEN lineup_hold_status ELSE status END,
     status='held',hold_reason=CASE WHEN NEW.lineup_withdrawal_confirmed THEN 'lineup:withdrawal'
       WHEN NEW.lineup_fingerprint IS NOT NULL AND lineup_fingerprint IS DISTINCT FROM NEW.lineup_fingerprint THEN 'lineup:replacement'
       ELSE coalesce(CASE WHEN hold_reason LIKE 'lineup:%' THEN hold_reason END,'lineup:incomplete') END
   WHERE (match_id=NEW.id OR (bound_match_id=NEW.id AND resolver_key LIKE 'match.%'))
     AND (status IN ('open','locked','proposed') OR (status='held' AND hold_reason LIKE 'lineup:%'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_b_pause_lineup AFTER UPDATE OF pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id,lineup_withdrawal_confirmed ON matches
 FOR EACH ROW EXECUTE FUNCTION play_pause_lineup_markets();

-- Lock order is match -> market -> wallet for writes, publication and trades.
-- A stale quote cannot sneak in between detecting a substitution and pausing.
CREATE FUNCTION public.play_guard_lineup_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE x matches%ROWTYPE; mid uuid;
BEGIN
 mid:=coalesce(NEW.match_id,CASE WHEN NEW.resolver_key LIKE 'match.%' THEN NEW.bound_match_id END);
 IF mid IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO STRICT x FROM matches WHERE id=mid FOR UPDATE;
 IF x.lineup_fingerprint IS NULL THEN RAISE EXCEPTION 'lineup_incomplete'; END IF;
 IF NEW.lineup_fingerprint IS DISTINCT FROM x.lineup_fingerprint THEN RAISE EXCEPTION 'lineup_changed'; END IF;
 NEW.lineup_snapshot:=play_lineup_snapshot(mid);
 IF NEW.seed_source='elo' AND (x.pred_lineup_fingerprint IS DISTINCT FROM x.lineup_fingerprint OR x.pred_pair1_prob IS NULL)
 THEN RAISE EXCEPTION 'lineup_prediction_pending'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_a_guard_lineup BEFORE INSERT ON markets FOR EACH ROW EXECUTE FUNCTION play_guard_lineup_insert();

ALTER FUNCTION public.play_commit_trade(uuid,uuid,jsonb) RENAME TO play_commit_trade_without_lineup;
CREATE FUNCTION public.play_commit_trade(p_market_id uuid,p_user_id uuid,p_quote jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mid uuid; k text; m markets%ROWTYPE;
BEGIN
 SELECT coalesce(match_id,CASE WHEN resolver_key LIKE 'match.%' THEN bound_match_id END) INTO mid FROM markets WHERE id=p_market_id;
 IF mid IS NOT NULL THEN
   SELECT lineup_fingerprint INTO k FROM matches WHERE id=mid FOR UPDATE;
   SELECT * INTO STRICT m FROM markets WHERE id=p_market_id FOR UPDATE;
   IF k IS NULL OR m.lineup_fingerprint IS DISTINCT FROM k THEN RAISE EXCEPTION 'market_not_open'; END IF;
 END IF;
 RETURN play_commit_trade_without_lineup(p_market_id,p_user_id,p_quote);
END $$;
REVOKE ALL ON FUNCTION play_commit_trade_without_lineup(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION play_commit_trade(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_commit_trade(uuid,uuid,jsonb) TO service_role;

ALTER FUNCTION public.play_settle_market(uuid,text,text,text,integer) RENAME TO play_settle_market_without_lineup;
CREATE FUNCTION public.play_settle_market(p_market_id uuid,p_outcome text,p_reason text,p_actor text,p_expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mid uuid; k text; m markets%ROWTYPE;
BEGIN
 SELECT coalesce(match_id,CASE WHEN resolver_key LIKE 'match.%' THEN bound_match_id END) INTO mid FROM markets WHERE id=p_market_id;
 IF mid IS NOT NULL THEN
   SELECT lineup_fingerprint INTO k FROM matches WHERE id=mid FOR UPDATE;
   SELECT * INTO STRICT m FROM markets WHERE id=p_market_id FOR UPDATE;
   IF m.lineup_cancelled_at IS NOT NULL THEN
     DELETE FROM market_settlement_retries WHERE market_id=m.id;
     RETURN jsonb_build_object('revision',m.settlement_revision,'unchanged',true);
   END IF;
   IF p_outcome<>'void' AND (k IS NULL OR m.lineup_fingerprint IS DISTINCT FROM k OR m.hold_reason LIKE 'lineup:%')
   THEN RAISE EXCEPTION 'lineup_changed'; END IF;
 END IF;
 RETURN play_settle_market_without_lineup(p_market_id,p_outcome,p_reason,p_actor,p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION play_settle_market_without_lineup(uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION play_settle_market(uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_settle_market(uuid,text,text,text,integer) TO service_role;

CREATE FUNCTION public.play_reconcile_lineup_markets() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; m markets%ROWTYPE; x matches%ROWTYPE; n integer:=0; errors integer:=0;
BEGIN
 FOR r IN SELECT id,coalesce(match_id,bound_match_id) mid FROM markets WHERE status='held' AND hold_reason LIKE 'lineup:%' ORDER BY id LIMIT 100 LOOP
  BEGIN
   SELECT * INTO x FROM matches WHERE id=r.mid FOR UPDATE;
   SELECT * INTO m FROM markets WHERE id=r.id FOR UPDATE;
   IF m.status<>'held' OR m.hold_reason NOT LIKE 'lineup:%' THEN CONTINUE; END IF;
   IF x.status IN ('walkover','cancelled') OR m.hold_reason IN ('lineup:withdrawal','lineup:replacement') OR
     (x.lineup_fingerprint IS NOT NULL AND m.lineup_fingerprint IS NOT NULL AND m.lineup_fingerprint<>x.lineup_fingerprint) THEN
     PERFORM play_settle_market(m.id,'void','Match participants changed. Guacas returned.','lineup-reconciler',m.settlement_revision);
     UPDATE markets SET lineup_cancelled_at=clock_timestamp() WHERE id=m.id;
     n:=n+1;
   ELSIF x.lineup_fingerprint IS NOT NULL AND x.lineup_fingerprint=m.lineup_fingerprint
     AND x.pred_lineup_fingerprint=x.lineup_fingerprint THEN
     UPDATE markets SET status=CASE WHEN m.lineup_hold_status='open' AND x.status='scheduled' AND m.locks_at>clock_timestamp() THEN 'open' ELSE 'locked' END,
       hold_reason=NULL,lineup_hold_status=NULL WHERE id=m.id;
     n:=n+1;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   errors:=errors+1;
   INSERT INTO market_audit_log(market_id,actor,action,reason) VALUES(r.id,'lineup-reconciler','lineup_retry',SQLERRM);
  END;
 END LOOP;
 RETURN jsonb_build_object('processed',n,'errors',errors);
END $$;
REVOKE ALL ON FUNCTION play_reconcile_lineup_markets() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_reconcile_lineup_markets() TO service_role;

-- Keep original records, but permit a separate market for a new lineup.
DROP INDEX markets_one_per_template_match;
CREATE UNIQUE INDEX markets_one_per_template_match ON markets(template_id,match_id,category,lineup_fingerprint) WHERE match_id IS NOT NULL;
DROP INDEX markets_one_per_editorial_contract;
CREATE UNIQUE INDEX markets_one_per_editorial_contract ON markets (
 season_id,template_id,category,
 play_market_identity(resolver_key,resolver_params,match_id,tournament_id,editorial_scope),
 coalesce(lineup_fingerprint,'')
) WHERE editorial_scope IS NOT NULL;
CREATE OR REPLACE FUNCTION public.play_guard_market_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE lim market_limits%ROWTYPE; owner_tournament uuid; daily_start timestamptz;
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
 IF coalesce(NEW.bound_match_id,NEW.match_id) IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM matches WHERE id=coalesce(NEW.bound_match_id,NEW.match_id) AND status='scheduled' AND scheduled_at>=NEW.locks_at AND scheduled_at>clock_timestamp())
 THEN RAISE EXCEPTION 'match_already_started_or_rescheduled'; END IF;
 NEW.question_snapshot := coalesce(NEW.question_snapshot,(SELECT question_i18n FROM market_templates WHERE id=NEW.template_id));
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.play_freeze_market_definition() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF ROW(NEW.lineup_snapshot,NEW.lineup_fingerprint,NEW.template_id,NEW.season_id,NEW.match_id,NEW.tournament_id,NEW.editorial_scope,NEW.category,NEW.tokens,NEW.resolver_key,NEW.resolver_params,NEW.lmsr_b,NEW.seed_prob,NEW.seed_source,NEW.question_snapshot,NEW.rules_snapshot,NEW.bound_match_id)
 IS DISTINCT FROM ROW(OLD.lineup_snapshot,OLD.lineup_fingerprint,OLD.template_id,OLD.season_id,OLD.match_id,OLD.tournament_id,OLD.editorial_scope,OLD.category,OLD.tokens,OLD.resolver_key,OLD.resolver_params,OLD.lmsr_b,OLD.seed_prob,OLD.seed_source,OLD.question_snapshot,OLD.rules_snapshot,OLD.bound_match_id)
 THEN RAISE EXCEPTION 'market_definition_is_frozen'; END IF;
 IF NEW.locks_at>OLD.locks_at THEN RAISE EXCEPTION 'cannot_extend_trading'; END IF;
 RETURN NEW;
END $$;

CREATE INDEX matches_pending_lineup_refresh ON matches(scheduled_at) WHERE status='scheduled' AND (lineup_prediction_pending OR lineup_market_refresh_pending);

-- Model jobs can finish after the lineup changes. Reject their stale output,
-- including writes from an older worker during a rolling deployment.
CREATE FUNCTION public.play_guard_prediction_write() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.pred_pair1_prob IS NOT NULL AND (NEW.lineup_fingerprint IS NULL OR NEW.pred_lineup_fingerprint IS DISTINCT FROM NEW.lineup_fingerprint) THEN
   NEW.pred_pair1_prob:=NULL; NEW.pred_model_version:=NULL; NEW.pred_computed_at:=NULL; NEW.pred_lineup_fingerprint:=NULL;
   NEW.lineup_prediction_pending:=(NEW.lineup_fingerprint IS NOT NULL AND NEW.status='scheduled');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_z_guard_prediction BEFORE UPDATE OF pred_pair1_prob,pred_lineup_fingerprint ON matches
 FOR EACH ROW EXECUTE FUNCTION play_guard_prediction_write();
CREATE FUNCTION public.play_guard_snapshot_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE k text;
BEGIN
 SELECT lineup_fingerprint INTO k FROM matches WHERE id=NEW.match_id FOR SHARE;
 IF k IS NULL OR NEW.lineup_fingerprint IS DISTINCT FROM k THEN RETURN NULL; END IF;
 NEW.lineup_valid:=true;
 RETURN NEW;
END $$;
CREATE TRIGGER play_guard_snapshot BEFORE INSERT ON model_predictions FOR EACH ROW EXECUTE FUNCTION play_guard_snapshot_insert();

COMMIT;
