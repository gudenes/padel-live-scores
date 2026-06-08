-- supabase/migrations/20260608170000_event_notify_dedup.sql
-- Idempotency for event-driven notifications (premium-notifications Plan 2).
-- Apply: node scripts/apply-migration.mjs supabase/migrations/20260608170000_event_notify_dedup.sql

-- Per-row marker for the single-owning-row event used in Plan 2A.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS starting_notified_at timestamptz NULL;

COMMENT ON COLUMN public.tournaments.starting_notified_at IS
  'Set when the tournament_starting notification has been fired. NULL = not yet sent.';

-- Generic sent-log for many-to-one events that lack a single owning row
-- (Plan 2B: draw_released per tournament+category, player_entered per tournament+player).
-- event_key convention: "<category>:<scope...>" e.g. "draw_released:<tid>:<category>".
CREATE TABLE IF NOT EXISTS public.notification_events_sent (
  event_key text PRIMARY KEY,
  category   text NOT NULL,
  fired_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_events_sent ENABLE ROW LEVEL SECURITY;
-- service-role only (workers); no anon/auth policies.
