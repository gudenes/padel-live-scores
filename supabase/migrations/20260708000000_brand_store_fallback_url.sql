-- Brand-level affiliate fallback link.
-- When a racket has no deep product_url, the "Plays with" widget falls back to
-- the brand's zonadepadel.es "palas" category page (with our ?aff=5 affiliate
-- tag) so we still capture commission instead of showing a dead end.

ALTER TABLE padel_brands ADD COLUMN IF NOT EXISTS store_url TEXT;

-- Seed the verified zonadepadel.es brand category pages (all return HTTP 200).
-- Matched by brand name as stored in padel_brands.
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/27-palas-de-padel-head?aff=5'        WHERE name = 'HEAD';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/30-palas-de-padel-nox?aff=5'         WHERE name = 'Nox';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/35-palas-de-padel-adidas?aff=5'      WHERE name = 'Adidas';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/4-palas-de-padel-bullpadel-?aff=5'   WHERE name = 'Bullpadel';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/97-palas-de-padel-babolat?aff=5'     WHERE name = 'Babolat';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/156-palas-de-padel-siux?aff=5'       WHERE name = 'Siux';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/163-palas-de-padel-lok?aff=5'        WHERE name = 'Lok';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/5-palas-de-padel-drop-shot?aff=5'    WHERE name = 'Dropshot';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/36-palas-de-padel-wilson?aff=5'      WHERE name = 'Wilson';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/33-palas-de-padel-star-vie?aff=5'    WHERE name = 'StarVie';
UPDATE padel_brands SET store_url = 'https://www.zonadepadel.es/139-palas-de-padel-joma?aff=5'       WHERE name = 'Joma';
