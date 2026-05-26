-- supabase/migrations/20260524_auto_disable_rpc.sql

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
  -- Snapshot candidate count under the trigger conditions
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

  -- Circuit breaker
  IF v_total > 0 AND v_candidates::float / v_total > circuit_breaker_threshold THEN
    INSERT INTO ops_events (kind, metadata)
    VALUES (
      'news_source.auto_disable.skipped_circuit_breaker',
      jsonb_build_object('candidate_count', v_candidates, 'total_enabled', v_total, 'threshold', circuit_breaker_threshold)
    );
    RETURN QUERY SELECT 'SKIPPED_CIRCUIT_BREAKER'::TEXT, 0, v_candidates, v_total, ARRAY[]::UUID[];
    RETURN;
  END IF;

  -- Perform disable
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
    RETURNING id, key, name, extraction_quality_pct, last_fetch_at,
      CASE
        WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
        WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
        ELSE 'low quality + errors'
      END AS reason
  )
  SELECT array_agg(id), count(*)::INT INTO v_disabled_ids, v_count FROM disabled;

  -- Per-source event log
  INSERT INTO ops_events (kind, metadata)
  SELECT 'news_source.auto_disabled',
         jsonb_build_object(
           'source_key', d.key, 'source_name', d.name,
           'reason', d.reason, 'quality_pct', d.extraction_quality_pct,
           'last_fetch_at', d.last_fetch_at
         )
  FROM (
    SELECT key, name, extraction_quality_pct, last_fetch_at,
      CASE
        WHEN last_fetch_at < now() - interval '14 days' THEN '14d no successful fetches'
        WHEN last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days' THEN '7d of consecutive errors'
        ELSE 'low quality + errors'
      END AS reason
    FROM news_sources
    WHERE id = ANY(COALESCE(v_disabled_ids, ARRAY[]::UUID[]))
  ) d;

  -- Run-level event
  INSERT INTO ops_events (kind, metadata)
  VALUES (
    'news_source.auto_disable.run',
    jsonb_build_object('disabled_count', v_count, 'candidate_count', v_candidates, 'total_enabled', v_total)
  );

  RETURN QUERY SELECT 'OK'::TEXT, v_count, v_candidates, v_total, COALESCE(v_disabled_ids, ARRAY[]::UUID[]);
END $$;

REVOKE ALL ON FUNCTION public.auto_disable_dead_sources FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_disable_dead_sources TO service_role;
