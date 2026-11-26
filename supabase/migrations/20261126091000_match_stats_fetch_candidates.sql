-- Keep provider percentages as percentages, not fabricated opportunity counts.
ALTER TABLE public.match_stats
  ADD COLUMN team1_break_points_converted_pct integer CHECK (team1_break_points_converted_pct BETWEEN 0 AND 100),
  ADD COLUMN team2_break_points_converted_pct integer CHECK (team2_break_points_converted_pct BETWEEN 0 AND 100);
-- Previously parsed values were retained in raw_payload: reuse them without
-- another provider fetch. Only the parser's numeric percentage shape is used.
UPDATE public.match_stats SET
  team1_break_points_converted_pct=(raw_payload->'team1'->>'breakPointsConvertedPct')::integer,
  team2_break_points_converted_pct=(raw_payload->'team2'->>'breakPointsConvertedPct')::integer
WHERE source='crionet_widget'
  AND jsonb_typeof(raw_payload->'team1'->'breakPointsConvertedPct')='number'
  AND jsonb_typeof(raw_payload->'team2'->'breakPointsConvertedPct')='number';

CREATE TABLE public.match_stats_fetch_state (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  next_attempt_at timestamptz NOT NULL
);
ALTER TABLE public.match_stats_fetch_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_stats_fetch_state FROM anon,authenticated;
CREATE INDEX matches_stats_candidates_idx ON public.matches(status,finished_at DESC,id)
  WHERE status IN ('live','on_court','finished');

-- Returns at most 20 mappings, regardless of PostgREST's response-row cap.
-- Final stats stop being candidates. Empty/error responses get a retry delay,
-- so one permanently empty historical match cannot monopolise the batch.
CREATE FUNCTION public.claim_match_stats_candidates(p_tournament_ids uuid[] DEFAULT NULL)
RETURNS TABLE(entity_id uuid,external_id text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH candidates AS MATERIALIZED (
    SELECT m.id,e.external_id,m.status,m.finished_at
    FROM public.matches m
    JOIN public.tournaments t ON t.id=m.tournament_id
    JOIN public.entity_external_ids e ON e.entity_type='match' AND e.entity_id=m.id AND e.source='crionet_widget'
    LEFT JOIN public.match_stats s ON s.match_id=m.id AND s.set_number=0 AND s.source='crionet_widget'
    LEFT JOIN public.match_stats_fetch_state f ON f.match_id=m.id
    WHERE m.status IN ('live','on_court','finished')
      AND (p_tournament_ids IS NULL OR m.tournament_id=ANY(p_tournament_ids))
      AND (lower(t.level) LIKE 'p1%' OR lower(t.level) LIKE 'p2%' OR lower(t.level) LIKE 'major%' OR lower(t.level) LIKE 'premier%' OR lower(t.level)='fip_platinum')
      AND e.external_id ~ '^[A-Z]+-[0-9]{4}-[0-9]+:[A-Za-z]+[0-9]+$'
      AND (f.next_attempt_at IS NULL OR f.next_attempt_at<=now())
      AND (m.status IN ('live','on_court') OR s.match_id IS NULL OR s.computed_at IS NULL OR s.computed_at<m.finished_at)
    ORDER BY CASE WHEN m.status IN ('live','on_court') THEN 0 WHEN m.finished_at >= now()-interval '24 hours' THEN 1 ELSE 2 END,
      coalesce(f.next_attempt_at,'-infinity'::timestamptz), m.finished_at DESC NULLS LAST,m.id
    LIMIT 20 FOR UPDATE OF m SKIP LOCKED
  ), claimed AS (
    INSERT INTO public.match_stats_fetch_state(match_id,next_attempt_at)
    SELECT id,now()+CASE WHEN status IN ('live','on_court') THEN interval '4 minutes'
      WHEN finished_at>=now()-interval '24 hours' THEN interval '15 minutes' ELSE interval '6 hours' END FROM candidates
    ON CONFLICT(match_id) DO UPDATE SET next_attempt_at=EXCLUDED.next_attempt_at
    RETURNING match_id
  )
  SELECT c.id,c.external_id FROM candidates c JOIN claimed f ON f.match_id=c.id;
$$;
REVOKE ALL ON FUNCTION public.claim_match_stats_candidates(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_match_stats_candidates(uuid[]) TO service_role;
