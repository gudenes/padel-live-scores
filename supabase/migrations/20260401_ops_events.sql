-- supabase/migrations/20260401_ops_events.sql
-- Ops events log for cron execution tracking

CREATE TABLE ops_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok', 'error', 'partial', 'timeout')),
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  duration_ms   int,
  meta          jsonb,
  error_message text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_ops_events_source_time ON ops_events (source, started_at DESC);

-- Allow anon reads (dashboard uses anon key via cookie-authed middleware)
-- Service key writes from cron handlers bypass RLS anyway
ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON ops_events FOR SELECT USING (true);
