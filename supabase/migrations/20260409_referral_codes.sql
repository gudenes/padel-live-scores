-- supabase/migrations/20260409_referral_codes.sql
-- Add referral_code + referred_by columns to profiles and open up
-- read access to basic profile fields so the invite welcome banner
-- and ambassador tier lookups work without server-side fetches.

-- ── Schema changes ──────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles(referred_by);

-- ── Public read policy ──────────────────────────────────────────────────────
-- Required for:
--   1. Welcome banner to fetch inviter display_name/avatar by referral_code
--   2. Ambassador tier count query (SELECT ... WHERE referred_by = user_id)
--      when the referred users are not yet friends of the viewer
-- Only display_name, avatar_url, referral_code, and referred_by are
-- intended to be public. preferred_country becomes readable too but is
-- not sensitive. Any future private fields (email, phone, etc.) must
-- live in a separate table that is NOT covered by this policy.

DROP POLICY IF EXISTS "Public profile read" ON public.profiles;
CREATE POLICY "Public profile read"
  ON public.profiles FOR SELECT
  USING (true);
