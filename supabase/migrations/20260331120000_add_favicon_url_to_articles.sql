-- Add favicon_url column to articles table for caching resolved favicons.
-- During sync, we resolve the real favicon URL (via Google's favicon service
-- using the article's actual domain) and store it here so the frontend
-- doesn't need to derive it client-side.

ALTER TABLE articles ADD COLUMN IF NOT EXISTS favicon_url TEXT;
