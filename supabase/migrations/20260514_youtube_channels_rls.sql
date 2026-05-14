-- supabase/migrations/20260514_youtube_channels_rls.sql
-- Additive companion to 20260514_youtube_channels.sql.
-- Adds RLS + public-read policies on both tables, and the
-- updated_at auto-refresh trigger on youtube_channels.

-- ── RLS on youtube_channels ─────────────────────────────────────────
ALTER TABLE youtube_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read youtube_channels"
  ON youtube_channels FOR SELECT
  USING (true);

-- ── RLS on youtube_channel_live ─────────────────────────────────────
ALTER TABLE youtube_channel_live ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read youtube_channel_live"
  ON youtube_channel_live FOR SELECT
  USING (true);

-- ── updated_at trigger on youtube_channels ──────────────────────────
-- Uses public.set_updated_at(), the canonical trigger function in this
-- project (see migrations 20260420000003, 20260420000006, etc.).
CREATE TRIGGER trg_youtube_channels_updated_at
  BEFORE UPDATE ON youtube_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
