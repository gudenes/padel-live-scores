-- Private scouting records have no public match/player/tournament foreign keys.
CREATE TABLE public.operator_manual_scouting_matches (
 id uuid PRIMARY KEY,
 players jsonb NOT NULL CHECK (jsonb_array_length(players) = 4),
 match_date date,
 tournament_label text NOT NULL DEFAULT '',
 video_url text NOT NULL DEFAULT '',
 request_hash text NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.operator_manual_video_scouting_sessions (
 match_id uuid PRIMARY KEY REFERENCES public.operator_manual_scouting_matches(id),
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
ALTER TABLE public.operator_manual_scouting_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_manual_video_scouting_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_manual_scouting_matches, public.operator_manual_video_scouting_sessions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.operator_manual_scouting_matches TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.operator_manual_video_scouting_sessions TO service_role;
