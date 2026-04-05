-- Extend user_bookmarks to support tournament and news_source types
ALTER TABLE public.user_bookmarks
  DROP CONSTRAINT IF EXISTS user_bookmarks_bookmark_type_check;

ALTER TABLE public.user_bookmarks
  ADD CONSTRAINT user_bookmarks_bookmark_type_check
    CHECK (bookmark_type IN ('match', 'player', 'tournament', 'news_source'));
