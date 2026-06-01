-- Add players.photo_url: high-res FIP player photo (Yoast primary image),
-- rehosted to the Supabase Storage `avatars` bucket under key
-- `{playerId}-full.{ext}`. avatar_url stays the 150x150 thumbnail.
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN players.photo_url IS
  'High-res FIP player photo (Yoast #primaryimage / og:image), rehosted to Supabase Storage avatars bucket as {id}-full.{ext}. avatar_url remains the 150x150 thumbnail.';
