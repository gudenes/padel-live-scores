BEGIN;
-- Preserve explicit opt-outs; new Predict users receive the morning push by default.
ALTER TABLE public.play_reminder_preferences ALTER COLUMN push_enabled SET DEFAULT true;
-- Keep same-day atomic deduplication; only email retains the rolling 24-hour limit.
CREATE OR REPLACE FUNCTION public.play_claim_reminder(p_user uuid,p_channel text,p_day date,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pref play_reminder_preferences%ROWTYPE; delivery play_reminder_deliveries%ROWTYPE; muted text;
BEGIN
 IF p_channel NOT IN ('email','push') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_channel,0));
 IF NOT EXISTS(SELECT 1 FROM feature_flags WHERE key='play_enabled' AND enabled)
 OR NOT EXISTS(SELECT 1 FROM play_access WHERE user_id=p_user) THEN RETURN NULL; END IF;
 SELECT * INTO pref FROM play_reminder_preferences WHERE user_id=p_user;
 IF NOT FOUND THEN
  pref.email_enabled := false; pref.push_enabled := true; pref.timezone := 'Europe/Madrid';
 END IF;
 IF (p_channel='email' AND NOT pref.email_enabled) OR (p_channel='push' AND NOT pref.push_enabled) THEN RETURN NULL; END IF;
 IF p_channel='push' AND EXISTS(SELECT 1 FROM profiles WHERE id=p_user AND notification_prefs->'marketing'->>'push'='false') THEN RETURN NULL; END IF;
 SELECT notification_mute_until INTO muted FROM profiles WHERE id=p_user;
 IF muted='forever' OR (muted IS NOT NULL AND muted<>'forever' AND muted::timestamptz>now()) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=pref.timezone) THEN RETURN NULL; END IF;
 IF p_day<>(now() AT TIME ZONE (CASE WHEN p_channel='push' THEN 'Europe/Madrid' ELSE pref.timezone END))::date THEN RETURN NULL; END IF;
 IF p_channel='email' AND EXISTS(SELECT 1 FROM play_reminder_deliveries WHERE user_id=p_user AND channel=p_channel AND
   (state='sent' AND sent_at>now()-interval '24 hours' OR state='pending' AND local_day<>p_day AND created_at>now()-interval '24 hours')) THEN RETURN NULL; END IF;
 SELECT * INTO delivery FROM play_reminder_deliveries WHERE user_id=p_user AND channel=p_channel AND local_day=p_day FOR UPDATE;
 IF FOUND THEN
  -- Mobile is best effort once; email retries reuse the exact payload/key.
  IF p_channel='push' OR delivery.state<>'pending' OR delivery.claimed_at>now()-interval '5 minutes'
     OR delivery.created_at<now()-interval '2 hours' OR delivery.attempts>=6 THEN RETURN NULL; END IF;
  UPDATE play_reminder_deliveries SET claimed_at=now(),attempts=attempts+1 WHERE id=delivery.id RETURNING * INTO delivery;
 ELSE
  INSERT INTO play_reminder_deliveries(user_id,channel,local_day,payload) VALUES(p_user,p_channel,p_day,p_payload) RETURNING * INTO delivery;
 END IF;
 RETURN to_jsonb(delivery);
END $$;
COMMIT;
