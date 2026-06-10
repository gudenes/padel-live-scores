-- supabase/migrations/20260609160000_managed_events.sql
-- Operator-curated event pages (Reserve Cup and future curated events).
-- Standalone from the synced tournaments/matches pipeline. Writes go through
-- the apps/ops service-key client (bypasses RLS); anon reads active rows only.
-- Design: docs/superpowers/specs/2026-06-09-managed-events-design.md

CREATE TABLE IF NOT EXISTS managed_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  wordmark        text,
  badge_label     text NOT NULL DEFAULT 'Event',
  active          boolean NOT NULL DEFAULT false,
  status_override text CHECK (status_override IN ('upcoming','ongoing','finished')),
  country         text,
  location        text,
  venue           text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  prize_pool      text,
  cover_image_url text,
  ticket_url      text,
  footnote        text,
  watch_links     jsonb NOT NULL DEFAULT '[]'::jsonb,
  divisions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  format          jsonb NOT NULL DEFAULT '{}'::jsonb,
  results         jsonb,
  sort_weight     integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_managed_events_active_window
  ON managed_events (active, ends_at);

ALTER TABLE managed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS managed_events_anon_read ON managed_events;
CREATE POLICY managed_events_anon_read ON managed_events
  FOR SELECT TO anon
  USING (active = true);
