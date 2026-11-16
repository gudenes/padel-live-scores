-- Preserve source enablement/cadence; only migrate the blocked FIP REST path.
UPDATE public.news_sources
SET url = replace(url, '/wp-json/wp/v2/posts?', '/?rest_route=/wp/v2/posts&')
WHERE key = 'fip'
  AND url LIKE 'https://www.padelfip.com/wp-json/wp/v2/posts?%';
