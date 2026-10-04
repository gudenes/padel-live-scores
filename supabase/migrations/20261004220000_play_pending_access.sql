-- Reserve beta access for an email before its first signup. Entries are consumed
-- once, so removing play_access later cannot silently grant it again.
CREATE TABLE IF NOT EXISTS public.play_pending_access (
 email text PRIMARY KEY CHECK (email = lower(trim(email))),
 granted_by text,
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.play_pending_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_pending_access FROM anon, authenticated;
GRANT ALL ON public.play_pending_access TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pending_play_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 WITH claimed AS (
  DELETE FROM public.play_pending_access
  WHERE email = (SELECT lower(trim(email)) FROM public.users WHERE id=NEW.id)
  RETURNING granted_by,note
 )
 INSERT INTO public.play_access(user_id,granted_by,note)
 SELECT NEW.id,granted_by,note FROM claimed
 ON CONFLICT(user_id) DO NOTHING;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_play_access() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS claim_pending_play_access ON public.profiles;
CREATE TRIGGER claim_pending_play_access AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.claim_pending_play_access();
