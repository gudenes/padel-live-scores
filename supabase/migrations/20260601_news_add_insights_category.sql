-- supabase/migrations/20260601_news_add_insights_category.sql
-- Add 'insights' to the allowed news_posts categories (data-driven editorial:
-- earnings rankings, ranking deep-dives, trend pieces).

ALTER TABLE news_posts DROP CONSTRAINT IF EXISTS news_posts_category_check;

ALTER TABLE news_posts
  ADD CONSTRAINT news_posts_category_check
  CHECK (category IN ('announcements', 'product', 'insights'));
