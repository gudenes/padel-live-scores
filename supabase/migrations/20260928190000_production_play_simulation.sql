BEGIN;
CREATE TABLE public.play_sim_control (
 id integer PRIMARY KEY CHECK(id=1), paused integer NOT NULL DEFAULT 1 CHECK(paused IN (0,1)),
 next_tick bigint NOT NULL DEFAULT 0, interval_ms integer NOT NULL DEFAULT 120000 CHECK(interval_ms BETWEEN 5000 AND 300000),
 bot_limit integer NOT NULL DEFAULT 150 CHECK(bot_limit BETWEEN 1 AND 1000), worker_seen bigint NOT NULL DEFAULT 0
);
INSERT INTO public.play_sim_control(id) VALUES(1);
CREATE TABLE public.play_sim_bots (
 id text PRIMARY KEY, name text NOT NULL, actor_type text NOT NULL DEFAULT 'simulation_bot' CHECK(actor_type='simulation_bot'),
 prize_eligible integer NOT NULL DEFAULT 0 CHECK(prize_eligible=0), balance bigint NOT NULL CHECK(balance>=0),
 last_trade_at bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.play_sim_markets (
 id text PRIMARY KEY, source_market_id text UNIQUE, question text NOT NULL,
 seed double precision NOT NULL CHECK(seed>0 AND seed<1), b double precision NOT NULL CHECK(b>0),
 q_yes double precision NOT NULL, q_no double precision NOT NULL, locks_at bigint NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled','void'))
);
CREATE TABLE public.play_sim_positions (
 bot_id text REFERENCES public.play_sim_bots(id), market_id text REFERENCES public.play_sim_markets(id),
 side text CHECK(side IN ('yes','no')), shares double precision NOT NULL CHECK(shares>=0),
 cost bigint NOT NULL CHECK(cost>=0), PRIMARY KEY(bot_id,market_id,side)
);
CREATE TABLE public.play_sim_trades (
 id text PRIMARY KEY, bot_id text NOT NULL REFERENCES public.play_sim_bots(id), market_id text NOT NULL REFERENCES public.play_sim_markets(id),
 side text NOT NULL CHECK(side IN ('yes','no')), cost integer NOT NULL CHECK(cost>0), shares double precision NOT NULL CHECK(shares>0),
 price double precision NOT NULL, price_after double precision NOT NULL, created_at bigint NOT NULL
);
CREATE INDEX play_sim_trades_time ON public.play_sim_trades(created_at DESC);
CREATE INDEX play_sim_trades_bot ON public.play_sim_trades(bot_id,created_at);
CREATE INDEX play_sim_trades_market ON public.play_sim_trades(market_id,created_at);
CREATE TABLE public.play_sim_ledger (
 id text PRIMARY KEY, bot_id text NOT NULL REFERENCES public.play_sim_bots(id), amount bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('grant','buy','settlement','refund')),
 market_id text REFERENCES public.play_sim_markets(id), created_at bigint NOT NULL
);
CREATE TABLE public.play_sim_resolutions (
 market_id text PRIMARY KEY REFERENCES public.play_sim_markets(id), outcome text NOT NULL CHECK(outcome IN ('yes','no','void')),
 paid bigint NOT NULL, created_at bigint NOT NULL
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['control','bots','markets','positions','trades','ledger','resolutions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY','play_sim_'||t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated','play_sim_'||t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role','play_sim_'||t);
 END LOOP;
END $$;

CREATE FUNCTION public.play_simulation_configure(p_count integer,p_interval integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i integer; bot text; added text;
BEGIN
 IF p_count IS NULL OR p_interval IS NULL OR p_count NOT BETWEEN 1 AND 1000 OR p_interval NOT BETWEEN 5000 AND 300000 THEN RAISE EXCEPTION 'Invalid simulation settings'; END IF;
 PERFORM 1 FROM play_sim_control WHERE id=1 FOR UPDATE;
 FOR i IN 1..p_count LOOP
  bot := 'sim-bot-'||lpad(i::text,4,'0'); added:=NULL;
  INSERT INTO play_sim_bots(id,name,balance) VALUES(bot,'Bot '||lpad(i::text,4,'0'),10000) ON CONFLICT DO NOTHING RETURNING id INTO added;
  IF added IS NOT NULL THEN
   INSERT INTO play_sim_ledger(id,bot_id,amount,kind,created_at) VALUES('grant:'||bot,bot,10000,'grant',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
  END IF;
 END LOOP;
 UPDATE play_sim_control SET bot_limit=p_count,interval_ms=p_interval WHERE id=1;
END $$;
CREATE FUNCTION public.play_simulation_pause(p_paused boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE play_sim_control SET paused=CASE WHEN p_paused THEN 1 ELSE 0 END WHERE id=1;
$$;
CREATE FUNCTION public.play_simulation_leaders(p_period text) RETURNS TABLE(id text,name text,net_worth double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT b.id,b.name,b.balance::double precision + COALESCE((
 SELECT SUM(p.shares * CASE WHEN p.side='yes' THEN 1/(1+exp(GREATEST(-700,LEAST(700,(m.q_no-m.q_yes)/m.b))))
 ELSE 1-1/(1+exp(GREATEST(-700,LEAST(700,(m.q_no-m.q_yes)/m.b)))) END)
 FROM play_sim_positions p JOIN play_sim_markets m ON m.id=p.market_id WHERE p.bot_id=b.id AND m.status='open'),0)
 FROM play_sim_bots b WHERE b.prize_eligible=0 AND (p_period!='week' OR b.last_trade_at>=floor(extract(epoch FROM now())*1000)::bigint-604800000);
$$;
CREATE FUNCTION public.play_simulation_state() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT to_jsonb(c)||jsonb_build_object(
 'mode','production_simulation','prizeEligible',false,
 'bots',(SELECT count(*) FROM play_sim_bots),'trades',(SELECT count(*) FROM play_sim_trades),
 'limits',jsonb_build_object('botDaily',500,'marketDaily',2000,'botMarket',500,'maxStake',50,'maxDrift',0.10),
 'markets',COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('priceYes',1/(1+exp(GREATEST(-700,LEAST(700,(m.q_no-m.q_yes)/m.b)))))) FROM play_sim_markets m),'[]'::jsonb),
 'activity',COALESCE((SELECT jsonb_agg(x) FROM (
 SELECT t.id,b.name AS "displayName",m.question,t.side,t.cost AS guacas,to_char(to_timestamp(t.created_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
 FROM play_sim_trades t JOIN play_sim_bots b ON b.id=t.bot_id JOIN play_sim_markets m ON m.id=t.market_id ORDER BY t.created_at DESC,t.id DESC LIMIT 30) x),'[]'::jsonb),
 'audit',jsonb_build_object('ok',
 NOT EXISTS(SELECT 1 FROM play_sim_bots b LEFT JOIN play_sim_ledger l ON l.bot_id=b.id GROUP BY b.id HAVING b.balance!=COALESCE(sum(l.amount),0))
 AND NOT EXISTS(SELECT 1 FROM play_sim_trades t LEFT JOIN play_sim_ledger l ON l.id='buy:'||t.id WHERE l.id IS NULL OR l.amount != -t.cost OR l.bot_id!=t.bot_id OR l.market_id!=t.market_id)
 )) FROM play_sim_control c WHERE id=1;
$$;
REVOKE ALL ON FUNCTION public.play_simulation_configure(integer,integer),public.play_simulation_pause(boolean),public.play_simulation_leaders(text),public.play_simulation_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.play_simulation_configure(integer,integer),public.play_simulation_pause(boolean),public.play_simulation_leaders(text),public.play_simulation_state() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
