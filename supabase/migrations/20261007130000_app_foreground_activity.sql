BEGIN;
-- profiles has a public read policy, so precise activity belongs in its own table.
CREATE TABLE public.user_app_activity (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_app_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_app_activity FROM anon,authenticated;
GRANT ALL ON user_app_activity TO service_role;
CREATE FUNCTION public.record_app_foreground(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO user_app_activity(user_id,last_seen_at) VALUES(p_user,now())
 ON CONFLICT(user_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at
 WHERE user_app_activity.last_seen_at<now()-interval '1 minute';
$$;
REVOKE ALL ON FUNCTION record_app_foreground(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION record_app_foreground(uuid) TO service_role;
COMMIT;
