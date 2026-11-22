BEGIN;

-- One reward per invited account, across seasons and access re-grants.
CREATE TABLE public.play_referral_rewards (
 invited_user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 inviter_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 season_id uuid NOT NULL REFERENCES public.market_seasons(id),
 amount integer NOT NULL DEFAULT 500 CHECK (amount = 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.play_referral_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_referral_rewards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.play_referral_rewards TO service_role;


-- Called only after server-side signature, window, session and origin checks.
-- A new grant and its two social connections succeed or roll back together.
CREATE OR REPLACE FUNCTION public.play_accept_friend_invitation(p_user uuid, p_inviter uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE added uuid; rewarded uuid; recipient uuid; season public.market_seasons%ROWTYPE; wallet_created uuid;
BEGIN
  IF p_user IS NULL OR p_inviter IS NULL THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;
  -- Public launch: any existing account may invite friends.
  PERFORM 1 FROM public.profiles WHERE id = p_inviter FOR KEY SHARE;
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
  SELECT * INTO season FROM public.market_seasons WHERE status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_season'; END IF;

  INSERT INTO public.play_referral_rewards(invited_user_id, inviter_user_id, season_id)
  VALUES (p_user, p_inviter, season.id)
  ON CONFLICT (invited_user_id) DO NOTHING
  RETURNING invited_user_id INTO rewarded;

  IF rewarded IS NOT NULL THEN
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
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.play_accept_friend_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_accept_friend_invitation(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
