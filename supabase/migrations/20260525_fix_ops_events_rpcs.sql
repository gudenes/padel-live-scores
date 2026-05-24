-- supabase/migrations/20260525_fix_ops_events_rpcs.sql
-- The original V2 RPCs referenced ops_events.kind / ops_events.metadata which
-- don't exist (the actual columns are source / status / meta). This rewrites
-- them against the real schema.
--
-- Also: there's no per-fetch health event stream in ops_events today, so
-- the previous quality-pct computation had no data to work with. This
-- version derives quality_pct from news_sources.last_fetch_status as a
-- pragmatic V2 fallback: success=100, error=0, else NULL. Not a true 30-day
-- success rate — we'd need a per-fetch event source to compute that.

CREATE OR REPLACE FUNCTION public.refresh_source_quality_pct() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  updated INT;
BEGIN
  UPDATE news_sources
  SET extraction_quality_pct = CASE
    WHEN last_fetch_status = 'success' THEN 100.0
    WHEN last_fetch_status = 'error' THEN 0.0
    ELSE NULL
  END
  WHERE last_fetch_at IS NOT NULL
    AND last_fetch_at > now() - interval '30 days';

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END $$;

REVOKE ALL ON FUNCTION public.refresh_source_quality_pct FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_source_quality_pct TO service_role;


CREATE OR REPLACE FUNCTION public.auto_disable_dead_sources(circuit_breaker_threshold FLOAT DEFAULT 0.3)
RETURNS TABLE (
  status TEXT,
  disabled_count INT,
  candidate_count INT,
  total_enabled INT,
  disabled_ids UUID[]
) LANGUAGE plpgsql AS $$
DECLARE
  v_total INT;
  v_candidates INT;
  v_disabled_ids UUID[];
  v_count INT;
BEGIN
  SELECT count(*) INTO v_total FROM news_sources WHERE enabled = true;

  SELECT count(*) INTO v_candidates
  FROM news_sources
  WHERE enabled = true
    AND query_kind != 'static'
    AND auto_disabled_at IS NULL
    AND (
         last_fetch_at < now() - interval '14 days'
      OR (last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days')
      OR (extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days')
    );

  IF v_total > 0 AND v_candidates::float / v_total > circuit_breaker_threshold THEN
    INSERT INTO ops_events (source, status, meta)
    VALUES (
      'news_source.auto_disable.skipped_circuit_breaker',
      'partial',
      jsonb_build_object('candidate_count', v_candidates, 'total_enabled', v_total, 'threshold', circuit_breaker_threshold)
    );
    RETURN QUERY SELECT 'SKIPPED_CIRCUIT_BREAKER'::TEXT, 0, v_candidates, v_total, ARRAY[]::UUID[];
    RETURN;
  END IF;

  WITH disabled AS (
    UPDATE news_sources
    SET
      enabled = false,
      auto_disabled_at = now(),
      notes = COALESCE(notes || E'\n', '') || 'Auto-disabled: ' ||
        CASE
          WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
          WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
          WHEN extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days' THEN 'low quality (<20%) + 7d errors'
          ELSE 'unknown'
        END
    WHERE enabled = true
      AND query_kind != 'static'
      AND auto_disabled_at IS NULL
      AND (
           last_fetch_at < now() - interval '14 days'
        OR (last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days')
        OR (extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days')
      )
    RETURNING id
  )
  SELECT array_agg(id), count(*)::INT INTO v_disabled_ids, v_count FROM disabled;

  INSERT INTO ops_events (source, status, meta)
  SELECT 'news_source.auto_disabled',
         'ok',
         jsonb_build_object(
           'source_key', key, 'source_name', name,
           'reason', CASE
             WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
             WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
             ELSE 'low quality + errors'
           END,
           'quality_pct', extraction_quality_pct,
           'last_fetch_at', last_fetch_at
         )
  FROM news_sources
  WHERE id = ANY(COALESCE(v_disabled_ids, ARRAY[]::UUID[]));

  INSERT INTO ops_events (source, status, meta)
  VALUES (
    'news_source.auto_disable.run',
    'ok',
    jsonb_build_object('disabled_count', v_count, 'candidate_count', v_candidates, 'total_enabled', v_total)
  );

  RETURN QUERY SELECT 'OK'::TEXT, v_count, v_candidates, v_total, COALESCE(v_disabled_ids, ARRAY[]::UUID[]);
END $$;

REVOKE ALL ON FUNCTION public.auto_disable_dead_sources FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_disable_dead_sources TO service_role;
