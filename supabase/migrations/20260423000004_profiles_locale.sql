-- 20260423000004_profiles_locale.sql
--
-- Add `locale` column to profiles. Captured at signup from the
-- `NEXT_LOCALE` cookie set by next-intl's proxy; used by every
-- transactional email we'll send (welcome, password-less login hints,
-- deletion confirmation, etc.) so users get consistent language
-- regardless of which device they're on when an email fires.
--
-- Existing rows default to 'en'. Future rows get the captured locale
-- from the signup request. A "Language" setting in the profile page
-- (future work) will let users change it; all downstream emails read
-- the stored value.
--
-- CHECK constraint matches next-intl's configured locales
-- (src/i18n/routing.ts). If we ever add a locale, update both places.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_locale_supported_check
  CHECK (locale IN ('en', 'es', 'pt', 'it', 'fr'));

COMMIT;
