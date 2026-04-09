-- supabase/migrations/20260409_badge_system.sql
-- Badge & rewards system: user_badges, user_activity_log, login streak columns.

-- ── user_badges ─────────────────────────────────────────────────────────────
-- Stores which badges each user has unlocked and at which tier.

CREATE TABLE IF NOT EXISTS public.user_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  tier smallint NOT NULL DEFAULT 1,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id, tier)
);

CREATE INDEX IF NOT EXISTS user_badges_user_idx ON public.user_badges(user_id);
CREATE INDEX IF NOT EXISTS user_badges_badge_idx ON public.user_badges(badge_id);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- Anyone can read badges (trophy case is public)
CREATE POLICY "Public badge read"
  ON public.user_badges FOR SELECT
  USING (true);

-- Authenticated users can insert their own badges
CREATE POLICY "Users can earn badges"
  ON public.user_badges FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── user_activity_log ───────────────────────────────────────────────────────
-- Lightweight append-only event log for badge evaluation.

CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_user_action_idx
  ON public.user_activity_log(user_id, action);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Users can read and insert their own activity
CREATE POLICY "Users can read own activity"
  ON public.user_activity_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can log own activity"
  ON public.user_activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── Login streak columns on profiles ────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS login_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak integer NOT NULL DEFAULT 0;
