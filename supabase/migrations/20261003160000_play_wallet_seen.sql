-- Account-level acknowledgement; never modifies wallet balances or ledger rows.
CREATE TABLE play_wallet_seen (
 user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 season_id uuid NOT NULL REFERENCES market_seasons(id),
 balance integer NOT NULL,
 pending_id uuid, pending_balance integer,
 PRIMARY KEY(user_id,season_id)
);
ALTER TABLE play_wallet_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON play_wallet_seen FROM PUBLIC,anon,authenticated;
GRANT ALL ON play_wallet_seen TO service_role;
CREATE OR REPLACE FUNCTION play_wallet_changes(p_user uuid,p_season uuid,p_ack uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_balance integer; seen play_wallet_seen%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM play_access WHERE user_id=p_user) THEN RAISE EXCEPTION 'not_found'; END IF;
 SELECT balance INTO current_balance FROM user_guaca_balance WHERE user_id=p_user AND season_id=p_season FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('change',NULL); END IF;
 INSERT INTO play_wallet_seen(user_id,season_id,balance) VALUES(p_user,p_season,current_balance) ON CONFLICT DO NOTHING;
 SELECT * INTO seen FROM play_wallet_seen WHERE user_id=p_user AND season_id=p_season FOR UPDATE;
 IF p_ack IS NOT NULL THEN
  IF seen.pending_id=p_ack THEN
   UPDATE play_wallet_seen SET balance=pending_balance,pending_id=NULL,pending_balance=NULL WHERE user_id=p_user AND season_id=p_season;
  END IF;
  RETURN jsonb_build_object('acknowledged',seen.pending_id=p_ack);
 END IF;
 IF seen.pending_id IS NULL AND seen.balance<>current_balance THEN
  UPDATE play_wallet_seen SET pending_id=gen_random_uuid(),pending_balance=current_balance WHERE user_id=p_user AND season_id=p_season RETURNING * INTO seen;
 END IF;
 RETURN jsonb_build_object('change',CASE WHEN seen.pending_id IS NULL THEN NULL ELSE jsonb_build_object('id',seen.pending_id,'from',seen.balance,'to',seen.pending_balance) END);
END $$;
REVOKE ALL ON FUNCTION play_wallet_changes(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_wallet_changes(uuid,uuid,uuid) TO service_role;
