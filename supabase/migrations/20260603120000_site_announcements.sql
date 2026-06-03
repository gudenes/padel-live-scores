-- supabase/migrations/20260603120000_site_announcements.sql
-- Site-wide alert banner. Exactly one banner shows at a time (newest active
-- within its time window wins — see src/lib/announcement.ts::selectActiveAnnouncement).
-- Writes go through the ops app's service-key client (bypasses RLS).

CREATE TABLE IF NOT EXISTS site_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text NOT NULL,
  type        text NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','critical')),
  active      boolean NOT NULL DEFAULT false,
  starts_at   timestamptz,
  expires_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of active rows (the read route filters active=true, newest first).
CREATE INDEX IF NOT EXISTS idx_site_announcements_active
  ON site_announcements (active, updated_at DESC);

ALTER TABLE site_announcements ENABLE ROW LEVEL SECURITY;

-- Public read of active rows only (the banner is shown to everyone).
-- The time-window filter (starts_at/expires_at) and newest-wins selection are
-- applied in the API route via selectActiveAnnouncement().
DROP POLICY IF EXISTS site_announcements_anon_read ON site_announcements;
CREATE POLICY site_announcements_anon_read ON site_announcements
  FOR SELECT TO anon
  USING (active = true);
