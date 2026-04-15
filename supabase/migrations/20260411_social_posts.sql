-- Social content queue — auto-generated post drafts from match data
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                    -- e.g. "Match Highlight — Lebron vs Tapia QF"
  caption TEXT NOT NULL,                  -- full post text
  hashtags TEXT,                          -- hashtag string
  platform TEXT NOT NULL,                 -- 'Instagram' | 'X/Twitter' | 'TikTok'
  pillar TEXT NOT NULL,                   -- 'Match Highlight' | 'Tournament Preview' | 'Player Spotlight' | 'Prediction/Poll' | 'Women Coverage' | 'Weekly Roundup'
  status TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'approved' | 'scheduled' | 'posted' | 'rejected'
  source_data TEXT,                       -- what data this was generated from
  notes TEXT,                             -- manual notes
  schedule_date DATE,                     -- when to publish
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the review queue (drafts, oldest first)
CREATE INDEX idx_social_posts_status ON social_posts (status, created_at);
