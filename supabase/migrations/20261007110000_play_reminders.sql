BEGIN;
CREATE TABLE public.play_reminder_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 email_enabled boolean NOT NULL DEFAULT false,
 push_enabled boolean NOT NULL DEFAULT false,
 timezone text NOT NULL,
 unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.play_reminder_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK(channel IN ('email','push')),
 local_day date NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','skipped')),
 payload jsonb NOT NULL,
 attempts integer NOT NULL DEFAULT 1,
 claimed_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 provider_id text,
 UNIQUE(user_id,channel,local_day)
);
CREATE INDEX play_reminder_pending ON play_reminder_deliveries(created_at) WHERE state='pending';
ALTER TABLE play_reminder_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON play_reminder_preferences,play_reminder_deliveries FROM anon,authenticated;
GRANT ALL ON play_reminder_preferences,play_reminder_deliveries TO service_role;
-- Serialize claims per user/channel. Limits also survive device timezone changes.
CREATE FUNCTION public.play_claim_reminder(p_user uuid,p_channel text,p_day date,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pref play_reminder_preferences%ROWTYPE; delivery play_reminder_deliveries%ROWTYPE; muted text;
BEGIN
 IF p_channel NOT IN ('email','push') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_channel,0));
 IF NOT EXISTS(SELECT 1 FROM feature_flags WHERE key='play_enabled' AND enabled)
 OR NOT EXISTS(SELECT 1 FROM play_access WHERE user_id=p_user) THEN RETURN NULL; END IF;
 SELECT * INTO pref FROM play_reminder_preferences WHERE user_id=p_user;
 IF NOT FOUND OR (p_channel='email' AND NOT pref.email_enabled) OR (p_channel='push' AND NOT pref.push_enabled) THEN RETURN NULL; END IF;
 SELECT notification_mute_until INTO muted FROM profiles WHERE id=p_user;
 IF muted='forever' OR (muted IS NOT NULL AND muted<>'forever' AND muted::timestamptz>now()) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=pref.timezone) THEN RETURN NULL; END IF;
 IF p_day<>(now() AT TIME ZONE pref.timezone)::date THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM play_reminder_deliveries WHERE user_id=p_user AND channel=p_channel AND
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
REVOKE ALL ON FUNCTION play_claim_reminder(uuid,text,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION play_claim_reminder(uuid,text,date,jsonb) TO service_role;
COMMIT;
