-- player_suggestions: crowd-sourced corrections to player profile fields.
-- Submitted anonymously (or with the logged-in user attached) from the
-- player Overview "Suggest changes" sheet. Reviewed + applied per-field
-- from the ops "Suggestions" tab. All access is via API routes using the
-- service-role key; RLS is enabled with no anon policies (deny-by-default).

CREATE TABLE IF NOT EXISTS player_suggestions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_name           TEXT,                 -- snapshot of display name at submit time
  changes               JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{field, current, suggested}]
  comment               TEXT,
  submitted_by_user_id  UUID,
  submitted_by_email    TEXT,
  submitted_by_ip       TEXT,                 -- sha256 hash, first 32 chars
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'rejected')),
  reviewed_by           TEXT,
  reviewed_at           TIMESTAMPTZ,
  review_note           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_suggestions_pending
  ON player_suggestions (created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_player_suggestions_ip_recent
  ON player_suggestions (submitted_by_ip, created_at DESC);

ALTER TABLE player_suggestions ENABLE ROW LEVEL SECURITY;
-- Inserts/reads/updates go through API routes with the service-role key
-- (which bypasses RLS). No anon policies = deny-by-default for the browser.

COMMENT ON TABLE player_suggestions IS
  'Crowd-sourced player profile corrections from the Overview "Suggest changes" sheet. Reviewed in the ops Suggestions tab.';
