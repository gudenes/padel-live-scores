-- supabase/migrations/20260502_native_push_subscriptions.sql
-- Sibling to push_subscriptions (Web Push); stores FCM (Android) and
-- APNs (iOS, future) device tokens separately so Web Push schema
-- stays unchanged. Service-key access only — same pattern as the
-- other Auth.js-era tables (user_badges, match_ratings, etc.).

CREATE TABLE public.native_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  device_token text NOT NULL,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','es','pt','it','fr')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_token)
);

CREATE INDEX native_push_user_idx ON public.native_push_subscriptions(user_id);
