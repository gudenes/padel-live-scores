-- supabase/migrations/20260605_player_display_name_paquito.sql
-- Add a nickname display_name so fans can find players by the short name they
-- actually use. Reported via user feedback: searching "paquito" returned
-- nothing for Francisco Navarro because he had no display_name (the global
-- search now matches display_name, but his was null).
--
-- "Paquito" is his universally-known name, so setting it both fixes search and
-- improves how he renders across the app (same convention as Momo Gonzalez,
-- Edu Alonso, etc. seeded in 20260409_player_display_name.sql).
--
-- Targeted by id (ranking #10 men) to avoid touching any junior namesake.
UPDATE players
SET display_name = 'Paquito Navarro'
WHERE id = 'e9a332e8-7165-402a-86db-b5050e3fee64'
  AND display_name IS NULL;
