-- Adds notification_mute_until to profiles for the mute-notifications feature
-- (see docs/superpowers/specs/2026-05-27-notifications-redesign-design.md).
--
-- Value is either:
--   - NULL: not muted
--   - 'forever': muted until user explicitly un-mutes
--   - ISO 8601 timestamp: muted until that point in time
--
-- /api/push/notify checks this before any push fan-out. In-app inserts
-- still run (mute is push-only).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_mute_until text DEFAULT NULL;

COMMENT ON COLUMN public.profiles.notification_mute_until IS
  'Mute state for push notifications. NULL = not muted, ''forever'' = indefinite, otherwise ISO 8601 timestamp.';
