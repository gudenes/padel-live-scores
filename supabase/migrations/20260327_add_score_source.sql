-- Migration: Add score_source column to sets table
-- Purpose: Track provenance of each set score for the inference rule priority system
-- Values: 'api' (from writeFinalState/tournament sync), 'inferred' (from point inference), 'live' (from live tracking)
-- 
-- Priority: api > inferred > live
-- Tournament sync always overwrites 'inferred' with 'api' data when available

-- Step 1: Add the column
ALTER TABLE sets ADD COLUMN IF NOT EXISTS score_source text DEFAULT 'live';

-- Step 2: Add a check constraint for valid values
ALTER TABLE sets ADD CONSTRAINT sets_score_source_check 
  CHECK (score_source IN ('api', 'inferred', 'live') OR score_source IS NULL);

-- Step 3: Backfill existing rows
-- Finished/retired matches with a real set_score were written by the API or reconciliation
UPDATE sets 
SET score_source = 'api' 
WHERE set_score IS NOT NULL 
  AND match_id IN (
    SELECT id FROM matches WHERE status IN ('finished', 'retired', 'walkover')
  )
  AND score_source = 'live';

-- Step 4: Create an index for the inference batch query
-- This supports the query: find sets with null score on finished matches within N days
CREATE INDEX IF NOT EXISTS idx_sets_inference_candidates
  ON sets (match_id, set_score, score_source)
  WHERE set_score IS NULL;

-- Step 5: Comment for documentation
COMMENT ON COLUMN sets.score_source IS 
  'Source of the set score: api (authoritative from padelapi.org), inferred (derived from last point), live (from live tracking)';
