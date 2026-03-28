-- Add logo_url to tournaments table for tournament branding display
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS logo_url TEXT;
