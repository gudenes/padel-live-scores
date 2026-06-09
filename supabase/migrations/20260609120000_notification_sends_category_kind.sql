-- supabase/migrations/20260609120000_notification_sends_category_kind.sql
-- Allow per-category event sends to be logged in notification_sends (Notifications console).
ALTER TABLE public.notification_sends DROP CONSTRAINT IF EXISTS notification_sends_kind_check;
ALTER TABLE public.notification_sends
  ADD CONSTRAINT notification_sends_kind_check CHECK (kind IN ('broadcast', 'match', 'category'));
