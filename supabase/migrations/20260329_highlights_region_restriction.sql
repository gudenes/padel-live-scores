-- Add region restriction columns to highlights table
-- allowed_countries: if set, video is ONLY available in these countries
-- blocked_countries: if set, video is NOT available in these countries
-- If both are null, the video is available everywhere
alter table highlights add column if not exists allowed_countries text[] default null;
alter table highlights add column if not exists blocked_countries text[] default null;
