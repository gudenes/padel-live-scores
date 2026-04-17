-- 20260417_profile_compliance.sql
-- Adds the marketing email consent column required by the Phase 1
-- compliance foundations work (GDPR Art. 7). Default false — consent must
-- be explicit. Set via PATCH /api/user/marketing-prefs.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.marketing_opt_in IS
  'User consent for broadcast marketing emails. Set via /api/user/marketing-prefs. Default false (opt-in model).';
