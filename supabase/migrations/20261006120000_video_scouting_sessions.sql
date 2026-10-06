-- Operator observations from the browser extension, separate from official scores.
CREATE TABLE public.operator_video_scouting_sessions (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id),
  revision integer NOT NULL CHECK (revision > 0),
  write_id uuid NOT NULL,
  document jsonb NOT NULL,
  score jsonb NOT NULL,
  stats jsonb NOT NULL,
  players jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_video_scouting_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_video_scouting_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.operator_video_scouting_sessions TO service_role;
