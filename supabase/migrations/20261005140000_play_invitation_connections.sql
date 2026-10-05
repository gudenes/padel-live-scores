BEGIN;

-- Called only after server-side signature, window, session and origin checks.
-- A new grant and its two social connections succeed or roll back together.
CREATE OR REPLACE FUNCTION public.play_accept_friend_invitation(p_user uuid, p_inviter uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE added uuid;
BEGIN
  IF p_user IS NULL OR p_inviter IS NULL THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;
  -- Lock the inviter's grant against concurrent revocation until commit.
  PERFORM 1 FROM public.play_access WHERE user_id = p_inviter FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
  IF p_user = p_inviter THEN RETURN false; END IF;

  INSERT INTO public.play_access(user_id, granted_by, note)
  VALUES (p_user, p_inviter::text, 'Padel Predict friend invitation')
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO added;

  -- Existing members and retries must never restore a deliberate unfollow.
  IF added IS NULL THEN RETURN false; END IF;

  INSERT INTO public.play_member_follows(follower_id, following_id)
  VALUES (p_user, p_inviter), (p_inviter, p_user)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.play_accept_friend_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_accept_friend_invitation(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
