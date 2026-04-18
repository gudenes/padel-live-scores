-- Index to support the future daily-recap Feed query.
-- Users will browse a feed of recent editorial posts in their locale,
-- ordered by freshness — this index makes that a single seek + scan
-- instead of a full-table sort.
--
-- Expected query shape:
--   SELECT * FROM editorial_posts
--   WHERE locale = $1
--     AND generated_at > NOW() - INTERVAL '7 days'
--   ORDER BY generated_at DESC
--   LIMIT 20;

CREATE INDEX IF NOT EXISTS idx_editorial_posts_feed
  ON editorial_posts (locale, generated_at DESC);

COMMENT ON INDEX idx_editorial_posts_feed IS
  'Supports the Feed "daily recap" query — recent editorial posts per locale.';
