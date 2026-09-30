BEGIN;
CREATE TABLE public.avatar_provider_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false,
 encrypted_key jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.avatar_provider_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avatar_provider_settings FROM anon,authenticated;
GRANT ALL ON public.avatar_provider_settings TO service_role;
INSERT INTO public.avatar_provider_settings(id) VALUES(true);
CREATE TABLE public.avatar_generation_usage (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 day date NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 lease_id uuid,
 locked_until timestamptz
);
ALTER TABLE public.avatar_generation_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avatar_generation_usage FROM anon,authenticated;
GRANT ALL ON public.avatar_generation_usage TO service_role;
CREATE FUNCTION public.reserve_avatar_generation(p_user_id uuid,p_lease_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u avatar_generation_usage%ROWTYPE; today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
 INSERT INTO avatar_generation_usage(user_id,day) VALUES(p_user_id,today) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT u FROM avatar_generation_usage WHERE user_id=p_user_id FOR UPDATE;
 IF u.locked_until>now() THEN RETURN 'generation_busy'; END IF;
 IF u.day=today AND u.attempts>=5 THEN RETURN 'daily_limit'; END IF;
 UPDATE avatar_generation_usage SET day=today,attempts=CASE WHEN u.day=today THEN u.attempts+1 ELSE 1 END,
 lease_id=p_lease_id,locked_until=now()+interval '10 minutes' WHERE user_id=p_user_id;
 RETURN 'ok';
END $$;
CREATE FUNCTION public.release_avatar_generation(p_user_id uuid,p_lease_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE avatar_generation_usage SET lease_id=NULL,locked_until=NULL WHERE user_id=p_user_id AND lease_id=p_lease_id;
$$;
REVOKE ALL ON FUNCTION public.reserve_avatar_generation(uuid,uuid),public.release_avatar_generation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_avatar_generation(uuid,uuid),public.release_avatar_generation(uuid,uuid) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('play-avatars','play-avatars',false,20000000,ARRAY['image/png'])
 ON CONFLICT(id) DO NOTHING;
COMMIT;
