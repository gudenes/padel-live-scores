-- Add cover_image_url column for promotional tournament images.
-- Nullable; when set, surfaces (home featured, events list, detail page)
-- render the image as a hero. When null, surfaces fall back to today's design.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
