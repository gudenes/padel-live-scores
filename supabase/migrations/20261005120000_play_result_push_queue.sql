-- Durable match-level push grouping. No historical backfill or wallet changes.
CREATE TABLE play_result_push_queue (
 user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 due_at timestamptz,
 lease_until timestamptz,
 lease_token uuid,
 generation integer NOT NULL DEFAULT 1,
 dispatch jsonb,
 sent_notice_ids bigint[] NOT NULL DEFAULT '{}',
 match_sent boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,match_id)
);
ALTER TABLE play_result_push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON play_result_push_queue FROM anon, authenticated;
GRANT ALL ON play_result_push_queue TO service_role;

CREATE FUNCTION play_queue_match_push(p_user uuid,p_match uuid,p_result boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM feature_flags WHERE key='play_enabled' AND enabled=true)
 OR NOT EXISTS(SELECT 1 FROM play_access WHERE user_id=p_user)
 OR NOT EXISTS(SELECT 1 FROM market_positions p JOIN markets m ON m.id=p.market_id
 WHERE p.user_id=p_user AND m.match_id=p_match AND p.yes_shares+p.no_shares>0) THEN RETURN false; END IF;
 INSERT INTO play_result_push_queue(user_id,match_id,due_at)
 VALUES(p_user,p_match,now()+interval '30 seconds')
 ON CONFLICT(user_id,match_id) DO UPDATE SET
 generation=play_result_push_queue.generation+CASE WHEN p_result THEN 1 ELSE 0 END,
 due_at=CASE WHEN p_result THEN least(coalesce(play_result_push_queue.due_at,now()+interval '30 seconds'),now()+interval '30 seconds')
 ELSE play_result_push_queue.due_at END;
 RETURN true;
END $$;
CREATE FUNCTION play_result_push_enqueued() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mid uuid;
BEGIN
 SELECT match_id INTO mid FROM markets WHERE id=NEW.market_id;
 IF mid IS NOT NULL THEN PERFORM play_queue_match_push(NEW.user_id,mid,true); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER play_result_push_after_notice AFTER INSERT ON play_result_notices
FOR EACH ROW EXECUTE FUNCTION play_result_push_enqueued();

CREATE FUNCTION play_claim_result_pushes() RETURNS SETOF play_result_push_queue
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE play_result_push_queue q SET lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid()
 WHERE (user_id,match_id) IN (
 SELECT user_id,match_id FROM play_result_push_queue WHERE due_at<=now()
 AND (lease_until IS NULL OR lease_until<now()) ORDER BY due_at LIMIT 20 FOR UPDATE SKIP LOCKED
 ) RETURNING q.*;
$$;
CREATE FUNCTION play_finish_result_push(p_user uuid,p_match uuid,p_token uuid,p_generation integer,p_ids bigint[],p_sent boolean,p_retry boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE play_result_push_queue SET
 sent_notice_ids=ARRAY(SELECT DISTINCT unnest(sent_notice_ids||p_ids)),
 match_sent=match_sent OR p_sent,
 due_at=CASE WHEN p_retry OR generation>p_generation THEN now()+interval '1 minute' ELSE NULL END,
 dispatch=CASE WHEN p_retry THEN dispatch ELSE NULL END,
 lease_until=NULL,lease_token=NULL
 WHERE user_id=p_user AND match_id=p_match AND lease_token=p_token;
$$;
-- Device receipts avoid re-sending successful deliveries when another device fails.
CREATE TABLE play_result_push_receipts (
 delivery_key text PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE play_result_push_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON play_result_push_receipts FROM anon,authenticated;
GRANT ALL ON play_result_push_receipts TO service_role;
REVOKE ALL ON FUNCTION play_queue_match_push(uuid,uuid,boolean),play_result_push_enqueued(),play_claim_result_pushes(),play_finish_result_push(uuid,uuid,uuid,integer,bigint[],boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_queue_match_push(uuid,uuid,boolean),play_claim_result_pushes(),play_finish_result_push(uuid,uuid,uuid,integer,bigint[],boolean,boolean) TO service_role;
