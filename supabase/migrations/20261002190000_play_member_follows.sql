BEGIN;
CREATE TABLE IF NOT EXISTS public.play_member_follows (
 follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(follower_id,following_id),
 CHECK(follower_id<>following_id)
);
CREATE INDEX IF NOT EXISTS play_member_followers ON public.play_member_follows(following_id,follower_id);
ALTER TABLE public.play_member_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_member_follows FROM anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.play_member_follows TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
