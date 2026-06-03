-- supabase/migrations/20260603_notification_analytics.sql
-- Durable per-send analytics for push notifications. One notification_sends
-- row per send EVENT (a broadcast, or one /api/push/notify match fan-out).
-- notification_clicks records web click-through, attributed via send_id that
-- rides in the push payload's data block. Service-key access only.

CREATE TABLE IF NOT EXISTS public.notification_sends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind             TEXT NOT NULL CHECK (kind IN ('broadcast', 'match')),
  title            TEXT NOT NULL,
  body             TEXT,
  url              TEXT,
  label            TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  dry_run          BOOLEAN NOT NULL DEFAULT false,

  web_fired        INT NOT NULL DEFAULT 0,
  web_accepted     INT NOT NULL DEFAULT 0,
  web_stale        INT NOT NULL DEFAULT 0,

  fcm_fired        INT NOT NULL DEFAULT 0,
  fcm_accepted     INT NOT NULL DEFAULT 0,
  fcm_failed       INT NOT NULL DEFAULT 0,
  fcm_stale        INT NOT NULL DEFAULT 0,

  anon_fired       INT NOT NULL DEFAULT 0,
  anon_accepted    INT NOT NULL DEFAULT 0,
  anon_stale       INT NOT NULL DEFAULT 0,

  recipients_total INT NOT NULL DEFAULT 0,
  accepted_total   INT NOT NULL DEFAULT 0,
  clicks           INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS notification_sends_created_idx
  ON public.notification_sends (created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_clicks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id     UUID NOT NULL REFERENCES public.notification_sends(id) ON DELETE CASCADE,
  clicked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform    TEXT
);

CREATE INDEX IF NOT EXISTS notification_clicks_send_idx
  ON public.notification_clicks (send_id);

ALTER TABLE public.notification_sends  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_clicks ENABLE ROW LEVEL SECURITY;
-- No policies: service role bypasses RLS; anon/auth roles get no access.

-- Atomic click increment used by POST /api/push/click.
CREATE OR REPLACE FUNCTION public.increment_notification_clicks(p_send_id UUID)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.notification_sends SET clicks = clicks + 1 WHERE id = p_send_id;
$$;
