-- IANA timezone on push subscriptions so match_scheduled titles can show
-- the recipient's local clock ("13:00") instead of a bare tournament hour.
-- Captured at subscribe time from the device
-- (Intl.DateTimeFormat().resolvedOptions().timeZone). Null until the device
-- re-registers; notify-event then falls back to tournament tz + abbreviation.

ALTER TABLE public.native_push_subscriptions
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.anon_push_subscriptions
  ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.native_push_subscriptions.timezone IS
  'IANA timezone of the device at last token register (e.g. America/Sao_Paulo).';
COMMENT ON COLUMN public.push_subscriptions.timezone IS
  'IANA timezone of the browser at last Web Push subscribe.';
COMMENT ON COLUMN public.anon_push_subscriptions.timezone IS
  'IANA timezone of the anonymous browser at last Web Push subscribe.';
