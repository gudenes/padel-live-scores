-- supabase/migrations/20260516_signup_tracking_fix.sql
--
-- Fix sign-up tracking after the Auth.js migration (2026-04-15).
--
-- Three problems this addresses:
--
-- 1. MISSING profiles.locale COLUMN: 20260423000004_profiles_locale.sql was
--    written but never applied to production. src/auth.ts events.createUser
--    has been INSERTing a `locale` column that doesn't exist, throwing 42703
--    "column does not exist", which is what was silently dropping ~95% of
--    sign-ups. Re-apply that ALTER here, idempotently.
--
-- 2. ORPHANED USERS: Because of problem #1, every Auth.js user since
--    2026-04-23 has no matching profiles row, no welcome email, no badge
--    eligibility, no Telegram notification. This migration backfills those
--    profiles from public.users.
--
-- 3. WRONG TRIGGER ATTACHMENT POINT: The Telegram new-signup webhook trigger
--    (20260410_signup_telegram_webhook.sql) fires on profiles INSERT — which
--    means it never fires when profile creation itself fails. Move it to
--    public.users so the notification fires on the canonical sign-up event,
--    independent of profile-creation outcome.
--
-- Sibling fix landing alongside this migration: the webhook handler at
-- src/app/api/webhooks/new-signup/route.ts is rewritten to read email + name
-- from the new payload + look up provider in the accounts table (the old
-- handler called supabase.auth.admin.getUserById which is dead post-Auth.js
-- migration and always returned "unknown").

BEGIN;

-- ── Step 0: ensure profiles.locale exists ─────────────────────────────────
-- Mirrors 20260423000004_profiles_locale.sql but guarded for idempotency
-- since prod's supabase_migrations.schema_migrations is out of sync with
-- the files on disk.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_locale_supported_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_locale_supported_check
      CHECK (locale IN ('en', 'es', 'pt', 'it', 'fr'));
  END IF;
END $$;

-- ── Step 1: drop the old trigger FIRST ────────────────────────────────────
-- Order matters: the backfill in step 2 inserts into public.profiles, which
-- would fire the existing on_profile_created_notify trigger and queue 21
-- spurious Telegram notifications via pg_net. Drop the trigger first so the
-- backfill is silent.

DROP TRIGGER IF EXISTS on_profile_created_notify ON public.profiles;

-- ── Step 2: backfill orphaned profiles ────────────────────────────────────
-- One row per Auth.js user that has no profile yet. ON CONFLICT keeps this
-- idempotent if the migration is re-run.

INSERT INTO public.profiles (id, display_name, avatar_url, locale, created_at)
SELECT
  u.id,
  u.name,
  u.image,
  'en',
  NOW()
FROM public.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── Step 3: install the trigger on users ──────────────────────────────────

-- Replace the trigger function with one that emits a richer payload — email,
-- name, image come straight from public.users so the webhook handler doesn't
-- need any cross-table lookups for the basics. Provider lookup (Google vs
-- Resend magic link) still happens server-side via the accounts table.

CREATE OR REPLACE FUNCTION public.notify_new_signup()
RETURNS trigger AS $$
DECLARE
  site_url text := current_setting('app.settings.site_url', true);
  cron_secret text := current_setting('app.settings.cron_secret', true);
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', jsonb_build_object(
      'id', NEW.id,
      'email', NEW.email,
      'name', NEW.name,
      'image', NEW.image
    ),
    'old_record', null
  );

  IF site_url IS NOT NULL AND cron_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url := site_url || '/api/webhooks/new-signup',
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || cron_secret
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created_notify
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_signup();

COMMIT;
