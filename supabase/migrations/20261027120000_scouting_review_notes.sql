-- Review annotations are deliberately separate from scoring/session documents.
CREATE TABLE public.scouting_review_notes (
 id uuid PRIMARY KEY,
 canonical_match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
 manual_match_id uuid REFERENCES public.operator_manual_scouting_matches(id) ON DELETE CASCADE,
 author_user_id uuid NOT NULL REFERENCES public.users(id),
 author_name text NOT NULL,
 video_url text NOT NULL DEFAULT '' CHECK (length(video_url) <= 2048),
 video_seconds integer CHECK (video_seconds BETWEEN 0 AND 86400),
 tag text NOT NULL CHECK (tag IN ('note','highlight','question','check')),
 note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (num_nonnulls(canonical_match_id, manual_match_id) = 1),
 CHECK (video_seconds IS NULL OR video_url <> '')
);
CREATE INDEX scouting_review_notes_canonical ON public.scouting_review_notes(canonical_match_id, created_at);
CREATE INDEX scouting_review_notes_manual ON public.scouting_review_notes(manual_match_id, created_at);
ALTER TABLE public.scouting_review_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scouting_review_notes FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.scouting_review_notes TO service_role;
