-- supabase/migrations/20260608120000_premium_notifications_foundation.sql
-- Premium Notifications foundation: Pro entitlement + waitlist.
-- Apply via:  node scripts/apply-migration.mjs supabase/migrations/20260608120000_premium_notifications_foundation.sql plan
-- (NOT `supabase db push` — repo has migration drift.)

-- 1. Entitlement on profiles. Default 'free'; billing (later spec) flips to 'pro'.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.plan IS
  'Entitlement tier. free|pro. Flipped manually until billing ships (see premium-notifications spec).';
COMMENT ON COLUMN public.profiles.plan_expires_at IS
  'Optional expiry for time-boxed Pro. NULL = no expiry. isPro() treats past expiry as free.';

-- 2. Pro waitlist (billing deferred — /pro CTA captures interest).
CREATE TABLE IF NOT EXISTS public.pro_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NULL,
  locale text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.pro_waitlist ENABLE ROW LEVEL SECURITY;
-- No anon/auth policies → only the service-role key (server routes) can read/write.
