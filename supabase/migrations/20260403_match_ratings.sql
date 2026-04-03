-- supabase/migrations/20260403_match_ratings.sql
-- Match ratings: per-user and per-device tracking with denormalized aggregates

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE public.match_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  device_id text,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT one_per_user UNIQUE NULLS NOT DISTINCT (match_id, user_id),
  CONSTRAINT one_per_device UNIQUE NULLS NOT DISTINCT (match_id, device_id),
  CONSTRAINT must_have_identity CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE INDEX idx_match_ratings_match ON public.match_ratings(match_id);

-- ── Denormalized columns on matches ──────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS avg_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS rating_count integer DEFAULT 0;

-- ── Trigger: recompute aggregates ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_match_rating_stats()
RETURNS trigger AS $$
DECLARE
  target_match_id uuid;
BEGIN
  target_match_id := COALESCE(NEW.match_id, OLD.match_id);
  UPDATE public.matches SET
    avg_rating = sub.avg,
    rating_count = sub.cnt
  FROM (
    SELECT
      ROUND(AVG(rating)::numeric, 1) AS avg,
      COUNT(*)::integer AS cnt
    FROM public.match_ratings
    WHERE match_id = target_match_id
  ) sub
  WHERE id = target_match_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_match_rating_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.match_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_match_rating_stats();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.match_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ratings"
  ON public.match_ratings FOR SELECT
  USING (true);

CREATE POLICY "Auth users can insert own ratings"
  ON public.match_ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Auth users can update own ratings"
  ON public.match_ratings FOR UPDATE
  USING (auth.uid() = user_id);

-- Note: Anonymous inserts/updates go through the API route using service key
