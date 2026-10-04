-- Account-scoped progress. No browser access; the authenticated Play API owns writes.
CREATE TABLE IF NOT EXISTS public.play_onboarding (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 step text NOT NULL DEFAULT 'identity' CHECK (step IN ('identity','wallet','prediction','done')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.play_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_onboarding FROM anon, authenticated;
GRANT ALL ON public.play_onboarding TO service_role;

-- Save identity and progress together without changing owned items or clothing.
CREATE OR REPLACE FUNCTION public.play_onboarding_identity(p_user uuid,p_name text,p_avatar text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF char_length(trim(p_name)) NOT BETWEEN 2 AND 24 OR p_name ~ '[[:cntrl:]@]' THEN
  RAISE EXCEPTION 'invalid_name';
 END IF;
 IF p_avatar IS NULL OR p_avatar !~ '^face-(0[1-9]|10)$' THEN RAISE EXCEPTION 'invalid_avatar'; END IF;
 UPDATE profiles SET display_name=trim(p_name) WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_missing'; END IF;
 INSERT INTO play_wardrobes(user_id,avatar) VALUES(p_user,p_avatar)
 ON CONFLICT(user_id) DO UPDATE SET avatar=EXCLUDED.avatar,updated_at=now();
 INSERT INTO play_onboarding(user_id,step) VALUES(p_user,'wallet')
 ON CONFLICT(user_id) DO UPDATE SET step=CASE WHEN play_onboarding.step='identity' THEN 'wallet' ELSE play_onboarding.step END,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.play_onboarding_identity(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.play_onboarding_identity(uuid,text,text) TO service_role;
