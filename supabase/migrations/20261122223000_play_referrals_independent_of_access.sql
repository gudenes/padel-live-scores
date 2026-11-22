BEGIN;

-- Public launch: access grants are independent of one-time referral eligibility.
CREATE OR REPLACE FUNCTION public.play_accept_friend_invitation(p_user uuid, p_inviter uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE rewarded uuid; recipient uuid; season public.market_seasons%ROWTYPE; wallet_created uuid;
BEGIN
  IF p_user IS NULL OR p_inviter IS NULL THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;
  -- Public launch: any existing account may invite friends.
  PERFORM 1 FROM public.profiles WHERE id = p_inviter FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
  IF p_user = p_inviter THEN RETURN false; END IF;

  SELECT * INTO season FROM public.market_seasons WHERE status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_season'; END IF;

  INSERT INTO public.play_referral_rewards(invited_user_id, inviter_user_id, season_id)
  VALUES (p_user, p_inviter, season.id)
  ON CONFLICT (invited_user_id) DO NOTHING
  RETURNING invited_user_id INTO rewarded;

  -- Retries and old referral links must not credit twice or restore an unfollow.
  IF rewarded IS NULL THEN RETURN false; END IF;

  INSERT INTO public.play_access(user_id, granted_by, note)
  VALUES (p_user, p_inviter::text, 'Padel Predict friend invitation')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.play_member_follows(follower_id, following_id)
  VALUES (p_user, p_inviter), (p_inviter, p_user)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  -- Stable wallet lock order avoids opposite-direction invitation deadlocks.
  FOR recipient IN SELECT id FROM (VALUES (p_user), (p_inviter)) AS recipients(id) ORDER BY id LOOP
    INSERT INTO public.user_guaca_balance(user_id, season_id, balance)
    VALUES (recipient, season.id, season.reset_balance)
    ON CONFLICT (user_id, season_id) DO NOTHING
    RETURNING user_id INTO wallet_created;
    IF wallet_created IS NOT NULL THEN
      INSERT INTO public.guaca_ledger(user_id, season_id, kind, amount, memo)
      VALUES (recipient, season.id, 'signup_grant', season.reset_balance, 'Season starting balance');
    END IF;
    UPDATE public.user_guaca_balance
    SET balance = balance + 500, updated_at = now()
    WHERE user_id = recipient AND season_id = season.id;
    INSERT INTO public.guaca_ledger(user_id, season_id, kind, amount, memo)
    VALUES (recipient, season.id, 'referral', 500, 'Predict invitation: ' || p_user::text);
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.play_accept_friend_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_accept_friend_invitation(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
