-- RLS policy for editorial_posts: public read access.
-- Editorial posts are meant to be indexed by Google and rendered in every
-- user's browser, so anon + authenticated both need SELECT. Writes stay
-- locked — only the cron (service-key) inserts.

ALTER TABLE editorial_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editorial_posts_public_read" ON editorial_posts;
CREATE POLICY "editorial_posts_public_read"
  ON editorial_posts
  FOR SELECT
  TO anon, authenticated
  USING (true);
