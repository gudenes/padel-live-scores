-- Operator-only observation log. Does not update matches, sets or match_points.
CREATE TABLE IF NOT EXISTS public.operator_scouting_sessions (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  document jsonb NOT NULL,
  players jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_scouting_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_scouting_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.operator_scouting_sessions TO service_role;
