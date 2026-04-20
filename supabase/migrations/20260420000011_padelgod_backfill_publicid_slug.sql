-- Padelgod foundation: backfill public_id + slug for all existing rows, then enforce UNIQUE/NOT NULL.

-- Helper: slugify a string for player slugs.
CREATE OR REPLACE FUNCTION public.padelgod_slugify(input TEXT)
RETURNS TEXT AS $$
DECLARE
  normalized TEXT;
BEGIN
  IF input IS NULL OR length(trim(input)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Lowercase, strip diacritics via unaccent if available, replace non-alphanumerics with hyphens
  normalized := lower(trim(input));
  -- unaccent extension already enabled (per existing migration 20260330_player_dedup_and_content_tagging)
  BEGIN
    normalized := public.unaccent(normalized);
  EXCEPTION WHEN undefined_function THEN
    -- unaccent not available; proceed without it
    NULL;
  END;
  normalized := regexp_replace(normalized, '[^a-z0-9]+', '-', 'g');
  normalized := regexp_replace(normalized, '^-+|-+$', '', 'g');
  RETURN normalized;
END;
$$ LANGUAGE plpgsql STABLE;

-- Backfill players.slug with disambiguation suffix on collisions
DO $$
DECLARE
  rec RECORD;
  base_slug TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR rec IN SELECT id, name FROM public.players WHERE slug IS NULL LOOP
    base_slug := public.padelgod_slugify(rec.name);
    IF base_slug IS NULL THEN
      CONTINUE;  -- skip players with NULL/empty names
    END IF;
    candidate := base_slug;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM public.players WHERE slug = candidate AND id <> rec.id) LOOP
      suffix := suffix + 1;
      candidate := base_slug || '-' || suffix;
    END LOOP;
    UPDATE public.players SET slug = candidate WHERE id = rec.id;
  END LOOP;
END $$;

-- Backfill public_id where DEFAULT didn't fire (existing rows pre-default)
UPDATE public.tournaments  SET public_id = public.public_id('tour') WHERE public_id IS NULL;
UPDATE public.players      SET public_id = public.public_id('plr')  WHERE public_id IS NULL;
UPDATE public.matches      SET public_id = public.public_id('mat')  WHERE public_id IS NULL;
UPDATE public.sets         SET public_id = public.public_id('set')  WHERE public_id IS NULL;
UPDATE public.games        SET public_id = public.public_id('gam')  WHERE public_id IS NULL;

-- Enforce UNIQUE + NOT NULL on public_id columns now that backfill is done
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_public_id_key UNIQUE (public_id);
ALTER TABLE public.tournaments ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.players ADD CONSTRAINT players_public_id_key UNIQUE (public_id);
ALTER TABLE public.players ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE public.players ADD CONSTRAINT players_slug_key UNIQUE (slug);
-- players.slug stays nullable in case future rows have NULL/empty names

ALTER TABLE public.matches ADD CONSTRAINT matches_public_id_key UNIQUE (public_id);
ALTER TABLE public.matches ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.sets ADD CONSTRAINT sets_public_id_key UNIQUE (public_id);
ALTER TABLE public.sets ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.games ADD CONSTRAINT games_public_id_key UNIQUE (public_id);
ALTER TABLE public.games ALTER COLUMN public_id SET NOT NULL;

-- Verification
DO $$
DECLARE
  null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM public.tournaments WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s tournaments have NULL public_id after backfill', null_count);

  SELECT COUNT(*) INTO null_count FROM public.players WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s players have NULL public_id after backfill', null_count);

  SELECT COUNT(*) INTO null_count FROM public.matches WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s matches have NULL public_id after backfill', null_count);

  SELECT COUNT(*) INTO null_count FROM public.sets WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s sets have NULL public_id after backfill', null_count);

  SELECT COUNT(*) INTO null_count FROM public.games WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s games have NULL public_id after backfill', null_count);

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'players_public_id_key' AND contype = 'u'
  ), 'players_public_id_key UNIQUE constraint missing';
END $$;
