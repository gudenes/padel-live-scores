-- supabase/migrations/20260603140000_site_announcements_title.sql
-- Optional bold lead-in for the alert banner (e.g. "Italy Major"). Nullable —
-- existing rows and title-less announcements render message only.

ALTER TABLE site_announcements ADD COLUMN IF NOT EXISTS title text;
