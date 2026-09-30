-- One shared publication boundary: every INSERT, including the scheduled generator,
-- is serialized against the limits row. No markets are opened by this migration.
BEGIN;
ALTER TABLE public.markets ADD COLUMN question_snapshot jsonb;
ALTER TABLE public.markets ADD COLUMN rules_snapshot jsonb;
ALTER TABLE public.markets ADD COLUMN bound_match_id uuid REFERENCES public.matches(id);
UPDATE public.markets m SET question_snapshot=t.question_i18n FROM public.market_templates t WHERE t.id=m.template_id;

CREATE TABLE public.market_editorial_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  config jsonb NOT NULL,
  preview jsonb, preview_token uuid, preview_expires_at timestamptz,
  market_id uuid REFERENCES public.markets(id),
  created_by text NOT NULL, updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_editorial_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_editorial_drafts FROM anon, authenticated;
GRANT ALL ON public.market_editorial_drafts TO service_role;
CREATE TABLE public.market_editorial_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES public.market_editorial_drafts(id),
  revision integer NOT NULL, action text NOT NULL, actor text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_editorial_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_editorial_audit FROM anon, authenticated;
GRANT ALL ON public.market_editorial_audit TO service_role;

CREATE FUNCTION public.play_market_identity(resolver text, params jsonb, match_id uuid, tournament_id uuid, scope text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT md5(jsonb_build_array(
   regexp_replace(resolver, '_v[0-9]+$', ''), match_id, tournament_id, scope,
   CASE WHEN resolver='match.winner_is_pair' THEN jsonb_build_object('pair',coalesce(params->'pair','1'::jsonb))
   ELSE (params - 'voidAfter' - 'player1Id' - 'player2Id') ||
     CASE WHEN params ? 'player1Id' THEN jsonb_build_object('pair',
       jsonb_build_array(least(params->>'player1Id',params->>'player2Id'),greatest(params->>'player1Id',params->>'player2Id')))
     ELSE '{}'::jsonb END END
 )::text)
$$;
CREATE INDEX markets_identity_lookup ON public.markets
  (season_id, public.play_market_identity(resolver_key,resolver_params,match_id,tournament_id,editorial_scope));

CREATE FUNCTION public.play_guard_market_insert() RETURNS trigger
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
   play_market_identity(NEW.resolver_key,NEW.resolver_params,NEW.match_id,NEW.tournament_id,NEW.editorial_scope))
 THEN RAISE EXCEPTION 'duplicate_market' USING ERRCODE='23505'; END IF;
 IF (SELECT count(*) FROM markets WHERE status='open')>=lim.max_open_markets THEN RAISE EXCEPTION 'open_market_limit'; END IF;
 IF (SELECT count(*) FROM markets WHERE created_at>=daily_start)>=lim.max_new_per_day THEN RAISE EXCEPTION 'daily_market_limit'; END IF;
 IF round(coalesce((SELECT sum(lmsr_b*ln(2::numeric)) FROM markets WHERE created_at>=daily_start),0)+NEW.lmsr_b*ln(2::numeric))>lim.max_subsidy_per_day THEN RAISE EXCEPTION 'daily_subsidy_limit'; END IF;
 IF NEW.match_id IS NOT NULL AND (SELECT count(*) FROM markets WHERE match_id=NEW.match_id AND season_id=NEW.season_id)>=lim.max_per_match THEN RAISE EXCEPTION 'match_market_limit'; END IF;
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
CREATE TRIGGER play_guard_market_insert BEFORE INSERT ON public.markets FOR EACH ROW EXECUTE FUNCTION public.play_guard_market_insert();

CREATE FUNCTION public.play_freeze_market_definition() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF ROW(NEW.template_id,NEW.season_id,NEW.match_id,NEW.tournament_id,NEW.editorial_scope,NEW.category,NEW.tokens,NEW.resolver_key,NEW.resolver_params,NEW.lmsr_b,NEW.seed_prob,NEW.seed_source,NEW.question_snapshot,NEW.rules_snapshot,NEW.bound_match_id)
 IS DISTINCT FROM ROW(OLD.template_id,OLD.season_id,OLD.match_id,OLD.tournament_id,OLD.editorial_scope,OLD.category,OLD.tokens,OLD.resolver_key,OLD.resolver_params,OLD.lmsr_b,OLD.seed_prob,OLD.seed_source,OLD.question_snapshot,OLD.rules_snapshot,OLD.bound_match_id)
 THEN RAISE EXCEPTION 'market_definition_is_frozen'; END IF;
 IF NEW.locks_at>OLD.locks_at THEN RAISE EXCEPTION 'cannot_extend_trading'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_freeze_market_definition BEFORE UPDATE ON public.markets FOR EACH ROW EXECUTE FUNCTION public.play_freeze_market_definition();

CREATE FUNCTION public.play_lock_started_markets() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('live','on_court','finished','retired','walkover','cancelled') THEN
   UPDATE markets SET status='locked',locks_at=least(locks_at,clock_timestamp())
   WHERE status='open' AND (match_id=NEW.id OR bound_match_id=NEW.id);
 ELSIF NEW.scheduled_at IS NOT NULL THEN
   UPDATE markets SET locks_at=least(locks_at,NEW.scheduled_at)
   WHERE status='open' AND (match_id=NEW.id OR bound_match_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_lock_started_markets AFTER UPDATE OF status,scheduled_at ON public.matches
 FOR EACH ROW EXECUTE FUNCTION public.play_lock_started_markets();

CREATE FUNCTION public.play_save_editorial_draft(p_id uuid,p_revision integer,p_config jsonb,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d market_editorial_drafts%ROWTYPE;
BEGIN
 IF p_id IS NULL THEN
   INSERT INTO market_editorial_drafts(config,created_by,updated_by) VALUES(p_config,p_actor,p_actor) RETURNING * INTO d;
 ELSE
   UPDATE market_editorial_drafts SET config=p_config,revision=revision+1,preview=NULL,preview_token=NULL,
     preview_expires_at=NULL,updated_by=p_actor,updated_at=now()
   WHERE id=p_id AND revision=p_revision AND status='draft' RETURNING * INTO d;
   IF NOT FOUND THEN RAISE EXCEPTION 'draft_changed_or_published'; END IF;
 END IF;
 INSERT INTO market_editorial_audit(draft_id,revision,action,actor,details) VALUES(d.id,d.revision,'saved',p_actor,p_config);
 RETURN to_jsonb(d);
END $$;

-- Only server-validated previews are stored; browsers cannot call these functions.
CREATE FUNCTION public.play_preview_editorial_draft(p_id uuid,p_revision integer,p_preview jsonb,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d market_editorial_drafts%ROWTYPE;
BEGIN
 UPDATE market_editorial_drafts SET preview=p_preview,preview_token=gen_random_uuid(),preview_expires_at=now()+interval '5 minutes',updated_by=p_actor
 WHERE id=p_id AND revision=p_revision AND status='draft' RETURNING * INTO d;
 IF NOT FOUND THEN RAISE EXCEPTION 'draft_changed_or_published'; END IF;
 RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.play_publish_editorial_draft(p_id uuid,p_revision integer,p_token uuid,p_fingerprint text,p_actor text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d market_editorial_drafts%ROWTYPE; v jsonb; m uuid; b numeric; template uuid;
BEGIN
 SELECT * INTO STRICT d FROM market_editorial_drafts WHERE id=p_id FOR UPDATE;
 IF d.status='published' AND d.preview_token=p_token THEN RETURN d.market_id; END IF;
 IF d.status<>'draft' OR d.revision<>p_revision OR d.preview_token IS DISTINCT FROM p_token
   OR d.preview_expires_at<=clock_timestamp() OR d.preview IS NULL OR d.preview->>'fingerprint' IS DISTINCT FROM p_fingerprint
 THEN RAISE EXCEPTION 'preview_expired_or_changed'; END IF;
 v:=d.preview;
 IF jsonb_array_length(v->'errors')<>0 THEN RAISE EXCEPTION 'preview_not_ready'; END IF;
 SELECT id INTO STRICT template FROM market_templates WHERE key=v->>'templateKey' AND enabled=true;
 b:=(v->>'maxLoss')::numeric/ln(2::numeric);
 INSERT INTO markets(season_id,template_id,tournament_id,editorial_scope,category,tokens,
   resolver_key,resolver_params,lmsr_b,seed_prob,seed_source,q_yes,q_no,status,locks_at,
   question_snapshot,rules_snapshot,bound_match_id)
 VALUES((v->>'seasonId')::uuid,template,(v->>'tournamentId')::uuid,v->>'editorialScope',v->>'category',v->'tokens',
   v->>'resolverKey',v->'params',b,(v->>'probability')::numeric,v->>'seedSource',
   b*ln((v->>'probability')::numeric),b*ln(1-(v->>'probability')::numeric),'open',(v->>'locksAt')::timestamptz,
   v->'question',v->'rules',(v->>'boundMatchId')::uuid) RETURNING id INTO m;
 UPDATE market_editorial_drafts SET status='published',market_id=m,updated_at=now(),updated_by=p_actor WHERE id=d.id;
 INSERT INTO market_editorial_audit(draft_id,revision,action,actor,details) VALUES(d.id,d.revision,'published',p_actor,jsonb_build_object('marketId',m,'preview',v));
 RETURN m;
END $$;
REVOKE ALL ON FUNCTION public.play_save_editorial_draft(uuid,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.play_preview_editorial_draft(uuid,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.play_publish_editorial_draft(uuid,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.play_save_editorial_draft(uuid,integer,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.play_preview_editorial_draft(uuid,integer,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.play_publish_editorial_draft(uuid,integer,uuid,text,text) TO service_role;

INSERT INTO public.market_templates(key,question_i18n,horizon,trigger,lock_rule,resolver_key,seed_source,enabled)
VALUES
 ('editorial.round.v1','{"en":"{question}"}','tournament','editorial','round_first_ball','tournament.pair_reaches_round_v1','projection',true),
 ('editorial.other_champion.v1','{"en":"{question}"}','tournament','editorial','round_first_ball','tournament.other_pair_wins_v1','projection',true),
 ('editorial.titles.v1','{"en":"{question}"}','season','editorial','fixed_deadline','season.pair_title_count_v1','fixed',true),
 ('editorial.ranking.v1','{"en":"{question}"}','season','editorial','fixed_deadline','player.reaches_ranking_v1','fixed',true);
COMMIT;
