-- Shared live calculations and diagnostic events; official FIP tables remain authoritative.
CREATE TABLE public.live_race_snapshots (
  gender text PRIMARY KEY CHECK (gender IN ('men','women')),
  snapshot jsonb NOT NULL,
  producer_region text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.live_race_profiles (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  baseline_date date NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id, baseline_date)
);
CREATE TABLE public.live_race_runs (
  id uuid PRIMARY KEY,
  gender text NOT NULL CHECK (gender IN ('men','women')),
  producer_region text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb,
  error_code text
);
CREATE INDEX live_race_runs_recent ON public.live_race_runs(started_at DESC);
CREATE TABLE public.live_race_fetch_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.live_race_runs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  route text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','failed')),
  http_status integer,
  error_code text,
  response_bytes bigint NOT NULL,
  duration_ms integer NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_race_attempts_recent ON public.live_race_fetch_attempts(attempted_at DESC);
ALTER TABLE public.live_race_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_race_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_race_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_race_fetch_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_race_snapshots, public.live_race_profiles, public.live_race_runs, public.live_race_fetch_attempts FROM anon, authenticated;
GRANT ALL ON public.live_race_snapshots, public.live_race_profiles, public.live_race_runs, public.live_race_fetch_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.live_race_fetch_attempts_id_seq TO service_role;

-- Return only operational summaries, never player history, URLs, or credentials.
CREATE FUNCTION public.live_race_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT jsonb_build_object(
  'snapshots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'gender',gender,'snapshot',snapshot - 'players','region',producer_region,'updatedAt',updated_at
  )) FROM public.live_race_snapshots),'[]'::jsonb),
  'runs', COALESCE((SELECT jsonb_agg(r) FROM (
    SELECT DISTINCT ON (gender) gender,status,started_at,completed_at,error_code,producer_region
    FROM public.live_race_runs ORDER BY gender,started_at DESC
  ) r),'[]'::jsonb),
  'routes', COALESCE((SELECT jsonb_agg(r) FROM (
    SELECT route,count(*)::int AS requests,count(*) FILTER(WHERE status='failed')::int AS failures,
      sum(response_bytes)::bigint AS bytes,max(attempted_at) AS last_attempt
    FROM public.live_race_fetch_attempts WHERE attempted_at >= now()-interval '24 hours' GROUP BY route
  ) r),'[]'::jsonb),
  'errors', COALESCE((SELECT jsonb_agg(r) FROM (
    SELECT error_code,count(*)::int AS count FROM public.live_race_fetch_attempts
    WHERE attempted_at >= now()-interval '24 hours' AND status='failed' GROUP BY error_code
  ) r),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION public.live_race_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_race_health() TO service_role;
