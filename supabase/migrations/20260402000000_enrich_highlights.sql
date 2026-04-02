-- Add engagement signals + description to highlights for improved feed scoring.
-- like_count and comment_count come from YouTube Data API (already fetched, now stored).
-- description enables better match signature extraction for dedup.
-- channel_quality_score is a computed signal based on engagement rate + priority status.

ALTER TABLE highlights ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS channel_quality_score REAL DEFAULT 1.0;
