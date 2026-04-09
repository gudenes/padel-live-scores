-- supabase/migrations/20260409_player_display_name.sql
-- Add display_name column for player name overrides.
-- When set, the app renders display_name instead of name.
-- The canonical `name` column stays untouched for API matching.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN public.players.display_name IS
  'Human-friendly name override. When set, rendered instead of the canonical `name` column. Use for Latin double-surname players where the common name differs from the official one (e.g. "Paula Josemaria" instead of "Paula Josemaria Martin").';

-- ── Seed display_name for top women players ─────────────────────
-- Spanish naming: FirstName MiddleName PaternalSurname MaternalSurname
-- Fans typically know players by FirstName + PaternalSurname (or just FirstName)

UPDATE players SET display_name = 'Gemma Triay' WHERE name = 'Gemma Triay Pons';
UPDATE players SET display_name = 'Delfina Brea' WHERE name = 'Delfina Brea Senesi';
UPDATE players SET display_name = 'Ari Sanchez' WHERE name = 'Ariana Sanchez Fallada';
UPDATE players SET display_name = 'Paula Josemaria' WHERE name = 'Paula Josemaria Martin';
UPDATE players SET display_name = 'Bea Gonzalez' WHERE name = 'Beatriz Gonzalez Fernandez';
UPDATE players SET display_name = 'Claudia Fernandez' WHERE name = 'Claudia Fernandez Sanchez';
UPDATE players SET display_name = 'Andrea Ustero' WHERE name = 'Andrea Ustero Prieto';
UPDATE players SET display_name = 'Tamara Icardo' WHERE name = 'Tamara Icardo Alcorisa';
UPDATE players SET display_name = 'Marta Ortega' WHERE name = 'Marta Ortega Gallego';
UPDATE players SET display_name = 'Ale Salazar' WHERE name = 'Alejandra Salazar Bengoechea';
UPDATE players SET display_name = 'Martina Calvo' WHERE name = 'Martina Calvo Santamaria';
UPDATE players SET display_name = 'Ale Alonso' WHERE name = 'Alejandra Alonso De Villa';
UPDATE players SET display_name = 'Bea Caldera' WHERE name = 'Beatriz Caldera Sanchez';
UPDATE players SET display_name = 'Carmen Goenaga' WHERE name = 'Carmen Goenaga Garcia';
UPDATE players SET display_name = 'Arantxa Osoro' WHERE name = 'Aranzazu Osoro Ulrich';
UPDATE players SET display_name = 'Victoria Iglesias' WHERE name = 'Victoria Iglesias Segador';
UPDATE players SET display_name = 'Lucia Sainz' WHERE name = 'Lucia Sainz Pelegri';
UPDATE players SET display_name = 'Patty Llaguno' WHERE name = 'Patricia Llaguno Zielinski';
UPDATE players SET display_name = 'Raquel Eugenio' WHERE name = 'Raquel Eugenio Barrera';
UPDATE players SET display_name = 'Martina Fassio' WHERE name = 'Martina Fassio Goyeneche';
UPDATE players SET display_name = 'Marta Barrera' WHERE name = 'Marta Barrera De La Fuente';
UPDATE players SET display_name = 'Jessica Castello' WHERE name = 'Jessica Castello Lopez';
UPDATE players SET display_name = 'Lorena Rufo' WHERE name = 'Lorena Rufo Ortiz';
UPDATE players SET display_name = 'Jimena Velasco' WHERE name = 'Jimena Velasco Postiguillo';
UPDATE players SET display_name = 'Marta Caparros' WHERE name = 'Marta Caparros Maldonado';
UPDATE players SET display_name = 'Noa Canovas' WHERE name = 'Noa Canovas Paredes';
UPDATE players SET display_name = 'Maria Rodriguez' WHERE name = 'Maria Eulalia Rodriguez Abajo';
UPDATE players SET display_name = 'Lucia Martinez' WHERE name = 'Lucia Martinez Gomez';
UPDATE players SET display_name = 'Agueda Perez' WHERE name = 'Agueda Perez Ortiz';
UPDATE players SET display_name = 'Juli Bidahorria' WHERE name = 'Julieta Evangelina Bidahorria';
UPDATE players SET display_name = 'Ana Catarina Nogueira' WHERE name = 'Ana Catarina Nogueira';
UPDATE players SET display_name = 'Melania Merino' WHERE name = 'Melania Merino Saez';
UPDATE players SET display_name = 'Leti Manquillo' WHERE name = 'Letizia Maria Manquillo Alarza';
UPDATE players SET display_name = 'Noemi Aguilar' WHERE name = 'Noemi Aguilar Carrillo';
UPDATE players SET display_name = 'Teresa Navarro' WHERE name = 'Teresa Navarro lopez-Barajas';
UPDATE players SET display_name = 'Julia Polo' WHERE name = 'Julia Polo Bautista';

-- ── Seed display_name for men players with double surnames ──────

UPDATE players SET display_name = 'Maxi Sanchez' WHERE name = 'Maxi Sanchez Blasco';
UPDATE players SET display_name = 'Maxi Sanchez' WHERE name = 'Maximiliano Sanchez Blasco';
UPDATE players SET display_name = 'Jose Diestro' WHERE name = 'Jose Antonio Diestro';
UPDATE players SET display_name = 'David Gala' WHERE name = 'David Gala Sanchez';
UPDATE players SET display_name = 'Guillermo Collado' WHERE name = 'Guillermo Collado Losada';
UPDATE players SET display_name = 'Pablo Garcia' WHERE name = 'Pablo Garcia Rodrigo';
UPDATE players SET display_name = 'Jose Jimenez' WHERE name = 'Jose Jimenez Casas';
UPDATE players SET display_name = 'Leo Aguirre' WHERE name = 'Leonel Daniel Aguirre';
UPDATE players SET display_name = 'Sanyo Gutierrez' WHERE name = 'Sanyo Gutierrez';
UPDATE players SET display_name = 'Carlos Gutierrez' WHERE name = 'Carlos Daniel Gutierrez';
