-- Add equipment JSONB column to players table
-- Stores racket brand, model, year, and optional affiliate URL
-- Example: {"racket_brand": "HEAD", "racket_model": "Coello Pro 2025", "racket_url": "https://..."}
ALTER TABLE players ADD COLUMN IF NOT EXISTS equipment JSONB DEFAULT NULL;

COMMENT ON COLUMN players.equipment IS 'Player equipment info (racket brand/model/url) as JSONB';
