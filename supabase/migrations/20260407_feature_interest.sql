-- feature_interest — generic "notify me when feature ships" opt-in table.
--
-- First use case: PadelGenius (daily tactics quiz) teaser on the home
-- page. Logged-in users tap "Notify Me" → row inserted. When the feature
-- ships, query WHERE feature_key='padel_genius' to get the list of
-- users to push-notify.
--
-- Generic schema (`feature_key` text) so we can reuse this table for
-- any future "coming soon" CTAs without new migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS feature_interest (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feature_interest_user_feature_uk UNIQUE (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS feature_interest_feature_idx
  ON feature_interest (feature_key);

COMMENT ON TABLE feature_interest IS 'Tracks users who opt in to be notified when an upcoming feature ships';
COMMENT ON COLUMN feature_interest.feature_key IS 'Stable identifier for the feature (e.g. padel_genius)';

-- ── RLS ──────────────────────────────────────────────────────
-- Each user can read + insert their own rows. Service role can do
-- anything (for the eventual "send notifications" cron).
ALTER TABLE feature_interest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own feature_interest" ON feature_interest;
DROP POLICY IF EXISTS "Users insert own feature_interest" ON feature_interest;
DROP POLICY IF EXISTS "Users delete own feature_interest" ON feature_interest;
DROP POLICY IF EXISTS "Service role full access feature_interest" ON feature_interest;

CREATE POLICY "Users read own feature_interest"
  ON feature_interest
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own feature_interest"
  ON feature_interest
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own feature_interest"
  ON feature_interest
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access feature_interest"
  ON feature_interest
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
