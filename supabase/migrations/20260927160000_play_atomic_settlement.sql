-- Apply with the matching transactional trade API. No live backfill is run by
-- this migration: the resolver catches up existing locked/proposed markets.
ALTER TABLE markets ADD COLUMN settlement_revision integer NOT NULL DEFAULT 0;
-- Corrections may recover an already-spent payout. A negative balance is an
-- explicit amount owed, offset by future credits; new buys remain blocked.
ALTER TABLE user_guaca_balance DROP CONSTRAINT user_guaca_balance_balance_check;

CREATE TABLE market_settlement_retries (
  market_id uuid PRIMARY KEY REFERENCES markets(id),
  last_error text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE market_settlement_retries ENABLE ROW LEVEL SECURITY;

CREATE TABLE market_payouts (
  market_id uuid NOT NULL REFERENCES markets(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  yes_paid integer NOT NULL DEFAULT 0,
  no_paid integer NOT NULL DEFAULT 0,
  revision integer NOT NULL,
  PRIMARY KEY(market_id,user_id)
);
CREATE TABLE play_result_notices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  revision integer NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('yes','no','void')),
  delta integer NOT NULL,
  reason text NOT NULL,
  corrected boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,market_id,revision)
);
ALTER TABLE market_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_result_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY payouts_own ON market_payouts FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY result_notices_own ON play_result_notices FOR SELECT TO authenticated USING(user_id=auth.uid());

-- Shared row lock with play_commit_trade serializes trading and settlement.
-- Positions are retained unchanged as the settlement/correction snapshot.
CREATE FUNCTION play_settle_market(p_market_id uuid,p_outcome text,p_reason text,p_actor text,
  p_expected_revision integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m markets%ROWTYPE; p market_positions%ROWTYPE; old market_payouts%ROWTYPE;
  yp integer; np integer; delta integer; rev integer; total integer:=0;
BEGIN
  IF p_outcome NOT IN ('yes','no','void') OR p_outcome IS NULL OR length(trim(coalesce(p_reason,'')))<3
    OR length(trim(coalesce(p_actor,'')))=0 THEN RAISE EXCEPTION 'invalid_settlement'; END IF;
  SELECT * INTO STRICT m FROM markets WHERE id=p_market_id FOR UPDATE;
  -- A retry of an already applied outcome is a no-op, including old clients.
  IF m.settlement_revision>0 AND ((m.status='void' AND p_outcome='void') OR
    (m.status='settled' AND m.outcome=(p_outcome='yes') AND p_outcome<>'void')) THEN
    DELETE FROM market_settlement_retries WHERE market_id=m.id;
    RETURN jsonb_build_object('revision',m.settlement_revision,'unchanged',true);
  END IF;
  IF m.settlement_revision<>p_expected_revision THEN RAISE EXCEPTION 'settlement_conflict'; END IF;
  IF m.settlement_revision=0 AND EXISTS(SELECT 1 FROM guaca_ledger WHERE market_id=m.id AND kind IN ('settlement','refund')) THEN
    RAISE EXCEPTION 'legacy_payout_requires_reconciliation';
  END IF;
  rev:=m.settlement_revision+1;
  FOR p IN SELECT * FROM market_positions WHERE market_id=m.id ORDER BY user_id FOR UPDATE LOOP
    yp:=0; np:=0;
    IF p_outcome='yes' THEN yp:=floor(p.yes_shares);
    ELSIF p_outcome='no' THEN np:=floor(p.no_shares);
    ELSIF p.yes_shares+p.no_shares>0 THEN
      yp:=floor(p.cost_basis*p.yes_shares/(p.yes_shares+p.no_shares)); np:=p.cost_basis-yp;
    END IF;
    SELECT * INTO old FROM market_payouts WHERE market_id=m.id AND user_id=p.user_id;
    delta:=yp+np-coalesce(old.yes_paid,0)-coalesce(old.no_paid,0);
    UPDATE user_guaca_balance SET balance=balance+delta,updated_at=now()
      WHERE user_id=p.user_id AND season_id=m.season_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing_wallet'; END IF;
    INSERT INTO guaca_ledger(user_id,season_id,kind,amount,market_id,memo)
      VALUES(p.user_id,m.season_id,CASE WHEN p_outcome='void' THEN 'refund' ELSE 'settlement' END,
        delta,m.id,'Result revision '||rev||': '||p_reason);
    INSERT INTO market_payouts VALUES(m.id,p.user_id,yp,np,rev)
      ON CONFLICT(market_id,user_id) DO UPDATE SET yes_paid=excluded.yes_paid,no_paid=excluded.no_paid,revision=excluded.revision;
    UPDATE market_positions SET realised_pnl=realised_pnl+delta-CASE WHEN rev=1 THEN cost_basis ELSE 0 END,updated_at=now()
      WHERE market_id=m.id AND user_id=p.user_id;
    INSERT INTO play_result_notices(user_id,market_id,revision,outcome,delta,reason,corrected)
      VALUES(p.user_id,m.id,rev,p_outcome,delta,p_reason,rev>1);
    INSERT INTO user_notifications(user_id,category,title,body,url,metadata)
      SELECT p.user_id,'play_result',CASE WHEN rev>1 THEN 'Prediction result corrected' ELSE 'Prediction settled' END,
        'Outcome: '||p_outcome||'. Balance adjustment: '||delta||' G. '||p_reason,
        '/play?view=mine',jsonb_build_object('market_id',m.id,'revision',rev,'delta',delta)
      FROM users WHERE id=p.user_id;
    total:=total+delta;
  END LOOP;
  UPDATE markets SET status=CASE WHEN p_outcome='void' THEN 'void' ELSE 'settled' END,
    outcome=CASE WHEN p_outcome='void' THEN NULL ELSE p_outcome='yes' END,
    settled_at=now(),settled_by=p_actor,settlement_revision=rev,hold_reason=NULL,
    void_reason=CASE WHEN p_outcome='void' THEN p_reason ELSE NULL END WHERE id=m.id;
  INSERT INTO market_audit_log(market_id,actor,action,reason,before,after)
    VALUES(m.id,p_actor,CASE WHEN rev=1 THEN 'settle' ELSE 'correct_settlement' END,p_reason,
      jsonb_build_object('status',m.status,'outcome',m.outcome,'revision',m.settlement_revision),
      jsonb_build_object('outcome',p_outcome,'revision',rev,'delta',total));
  DELETE FROM market_settlement_retries WHERE market_id=m.id;
  RETURN jsonb_build_object('revision',rev,'delta',total,'unchanged',false);
END $$;
REVOKE ALL ON FUNCTION play_settle_market(uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_settle_market(uuid,text,text,text,integer) TO service_role;

-- Immediate match-winner settlement, in the same transaction as the result.
-- Unknown winners never imply a loss. A later winner correction applies a delta.
CREATE FUNCTION play_match_result_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m markets%ROWTYPE; result text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.winner_pair IS NOT DISTINCT FROM OLD.winner_pair THEN RETURN NEW; END IF;
  FOR m IN SELECT * FROM markets WHERE match_id=NEW.id AND resolver_key='match.winner_is_pair'
    AND status<>'held' ORDER BY id LOOP
    IF NEW.status IN ('walkover','cancelled') THEN result:='void';
    ELSIF NEW.status IN ('finished','retired') AND NEW.winner_pair IN (1,2)
      AND m.resolver_params->>'pair' IN ('1','2') THEN
      result:=CASE WHEN NEW.winner_pair=(m.resolver_params->>'pair')::integer THEN 'yes' ELSE 'no' END;
    ELSE
      -- A revoked result needs an operator; do not silently keep calling it final.
      IF m.settlement_revision>0 THEN
        UPDATE markets SET status='held',hold_reason='Upstream result withdrawn after payout' WHERE id=m.id;
        INSERT INTO market_audit_log(market_id,actor,action,reason)
          VALUES(m.id,'match-result','hold','Upstream result withdrawn after payout');
        INSERT INTO user_notifications(user_id,category,title,body,url,metadata)
          SELECT p.user_id,'play_result','Prediction result under review',
            'The match result was withdrawn. Your payout is under review; any correction will be recorded and announced.',
            '/play?view=mine',jsonb_build_object('market_id',m.id)
          FROM market_positions p JOIN users u ON u.id=p.user_id WHERE p.market_id=m.id;
      END IF;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM play_settle_market(m.id,result,'Official match result','match-result',m.settlement_revision);
    EXCEPTION WHEN OTHERS THEN
      -- Preserve ingestion; the resolver retries and this failure stays visible.
      INSERT INTO market_audit_log(market_id,actor,action,reason)
        VALUES(m.id,'match-result','settlement_failed',SQLERRM);
      INSERT INTO market_settlement_retries(market_id,last_error) VALUES(m.id,SQLERRM)
        ON CONFLICT(market_id) DO UPDATE SET last_error=excluded.last_error,updated_at=now();
    END;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION play_match_result_changed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER play_match_result AFTER INSERT OR UPDATE OF status,winner_pair ON matches
  FOR EACH ROW EXECUTE FUNCTION play_match_result_changed();

-- Server-calculated LMSR quote; caller is service-role only. Validate its old
-- book/position under locks before committing all five writes atomically.
CREATE FUNCTION play_commit_trade(p_market_id uuid,p_user_id uuid,p_quote jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m markets%ROWTYPE; p market_positions%ROWTYPE; bal integer; tid bigint;
  cash integer:=(p_quote->>'cash')::integer; shares numeric:=(p_quote->>'shares')::numeric;
  side text:=p_quote->>'side'; direction text:=p_quote->>'direction'; max_stake integer;
BEGIN
  SELECT * INTO STRICT m FROM markets WHERE id=p_market_id FOR UPDATE;
  IF m.status<>'open' OR m.locks_at<=clock_timestamp() OR EXISTS(
    SELECT 1 FROM matches WHERE id=m.match_id AND status IN ('finished','retired','walkover','cancelled'))
    THEN RAISE EXCEPTION 'market_not_open'; END IF;
  IF m.q_yes<>(p_quote->>'oldYes')::numeric OR m.q_no<>(p_quote->>'oldNo')::numeric THEN RAISE EXCEPTION 'market_busy'; END IF;
  SELECT balance INTO STRICT bal FROM user_guaca_balance WHERE user_id=p_user_id AND season_id=m.season_id FOR UPDATE;
  SELECT * INTO p FROM market_positions WHERE market_id=m.id AND user_id=p_user_id FOR UPDATE;
  IF coalesce(p.yes_shares,0)<>(p_quote->>'heldYes')::numeric OR coalesce(p.no_shares,0)<>(p_quote->>'heldNo')::numeric
    OR coalesce(p.cost_basis,0)<>(p_quote->>'oldBasis')::integer THEN RAISE EXCEPTION 'trade_conflict'; END IF;
  IF side NOT IN ('yes','no') OR direction NOT IN ('buy','sell') OR shares<=0 OR cash IS NULL
    OR (direction='buy' AND cash>=0) OR (direction='sell' AND cash<0) THEN RAISE EXCEPTION 'invalid_trade'; END IF;
  IF direction='buy' AND bal+cash<0 THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
  IF direction='sell' AND shares>(CASE WHEN side='yes' THEN coalesce(p.yes_shares,0) ELSE coalesce(p.no_shares,0) END)
    THEN RAISE EXCEPTION 'insufficient_shares'; END IF;
  SELECT max_stake_user_market INTO max_stake FROM market_limits WHERE id=true;
  IF direction='buy' AND (p_quote->>'basis')::integer>coalesce(max_stake,2000) THEN RAISE EXCEPTION 'stake_limit'; END IF;
  UPDATE markets SET q_yes=(p_quote->>'newYes')::numeric,q_no=(p_quote->>'newNo')::numeric,
    volume_guacas=volume_guacas+abs(cash),position_count=(p_quote->>'positionCount')::integer WHERE id=m.id;
  UPDATE user_guaca_balance SET balance=balance+cash,updated_at=now() WHERE user_id=p_user_id AND season_id=m.season_id RETURNING balance INTO bal;
  INSERT INTO market_positions(market_id,user_id,yes_shares,no_shares,cost_basis,realised_pnl)
    VALUES(m.id,p_user_id,(p_quote->>'positionYes')::numeric,(p_quote->>'positionNo')::numeric,
      (p_quote->>'basis')::integer,(p_quote->>'pnl')::integer)
    ON CONFLICT(market_id,user_id) DO UPDATE SET yes_shares=excluded.yes_shares,no_shares=excluded.no_shares,
      cost_basis=excluded.cost_basis,realised_pnl=excluded.realised_pnl,updated_at=now();
  INSERT INTO market_trades(market_id,user_id,side,direction,shares,cost_guacas,price,q_yes_after,q_no_after)
    VALUES(m.id,p_user_id,side,direction,shares,cash,(p_quote->>'price')::numeric,m.q_yes,m.q_no)
    RETURNING id INTO tid;
  UPDATE market_trades SET q_yes_after=(p_quote->>'newYes')::numeric,q_no_after=(p_quote->>'newNo')::numeric WHERE id=tid;
  INSERT INTO guaca_ledger(user_id,season_id,kind,amount,market_id,trade_id)
    VALUES(p_user_id,m.season_id,CASE WHEN direction='buy' THEN 'trade_buy' ELSE 'trade_sell' END,cash,m.id,tid);
  RETURN jsonb_build_object('balance',bal,'tradeId',tid);
END $$;
REVOKE ALL ON FUNCTION play_commit_trade(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_commit_trade(uuid,uuid,jsonb) TO service_role;
