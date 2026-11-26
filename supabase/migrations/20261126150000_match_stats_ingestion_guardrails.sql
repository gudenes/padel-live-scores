-- Every real widget ID written by any match importer gets its stats lookup
-- atomically. Synthetic draw IDs deliberately remain outside this contract.
CREATE FUNCTION public.sync_match_stats_provider_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mapped uuid;
BEGIN
  IF NEW.widget_id_composite IS NULL OR
     NEW.widget_id_composite !~ '^[A-Z]+-[0-9]{4}-[0-9]+:[A-Za-z]+[0-9]+$' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.entity_external_ids(entity_type,entity_id,source,external_id)
  VALUES('match',NEW.id,'crionet_widget',NEW.widget_id_composite)
  ON CONFLICT(source,entity_type,external_id) DO UPDATE
    SET entity_id=EXCLUDED.entity_id,last_seen_at=now()
    WHERE NOT EXISTS(SELECT 1 FROM public.matches m WHERE m.id=entity_external_ids.entity_id);
  SELECT entity_id INTO mapped FROM public.entity_external_ids
    WHERE entity_type='match' AND source='crionet_widget' AND external_id=NEW.widget_id_composite;
  IF mapped IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Widget % already belongs to another match',NEW.widget_id_composite USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_stats_provider_link
AFTER INSERT OR UPDATE OF widget_id_composite ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.sync_match_stats_provider_link();

CREATE FUNCTION public.remove_deleted_match_provider_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  DELETE FROM public.entity_external_ids WHERE entity_type='match' AND entity_id=OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER match_provider_links_delete AFTER DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.remove_deleted_match_provider_links();
REVOKE ALL ON FUNCTION public.sync_match_stats_provider_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_deleted_match_provider_links() FROM PUBLIC;

-- Lock the referenced match against concurrent deletion, like a foreign key.
-- Existing legacy orphans can still be repaired; new orphan writes are rejected.
CREATE FUNCTION public.require_existing_match_provider_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.entity_type='match' THEN
    PERFORM 1 FROM public.matches WHERE id=NEW.entity_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Provider link references missing match %',NEW.entity_id USING ERRCODE='23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_provider_target_exists
BEFORE INSERT OR UPDATE OF entity_type,entity_id ON public.entity_external_ids
FOR EACH ROW EXECUTE FUNCTION public.require_existing_match_provider_target();
REVOKE ALL ON FUNCTION public.require_existing_match_provider_target() FROM PUBLIC;

ALTER TABLE public.match_stats_fetch_state
  ADD COLUMN last_outcome text CHECK(last_outcome IN ('success','empty','error')),
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN empty_attempts integer NOT NULL DEFAULT 0 CHECK(empty_attempts>=0);

-- One bounded outcome write per worker run. Provider absence is not an error:
-- back off historical empty responses, while live/recent matches stay fresh.
CREATE FUNCTION public.record_match_stats_outcomes(p_outcomes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; mid uuid; outcome text; streak integer; match_status text;
        completed timestamptz; delay interval;
BEGIN
  IF jsonb_typeof(p_outcomes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_outcomes)>20 THEN
    RAISE EXCEPTION 'Expected at most 20 match stats outcomes';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_outcomes) x GROUP BY x->>'match_id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate match stats outcomes';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_outcomes) LOOP
    mid := (item->>'match_id')::uuid;
    outcome := item->>'outcome';
    IF mid IS NULL OR outcome IS NULL OR outcome NOT IN ('success','empty','error') THEN
      RAISE EXCEPTION 'Invalid match stats outcome';
    END IF;
    -- Deleted matches need no retry. Only a previously claimed match is updated.
    SELECT m.status,m.finished_at INTO match_status,completed FROM public.matches m WHERE m.id=mid;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT empty_attempts INTO streak FROM public.match_stats_fetch_state WHERE match_id=mid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    streak := CASE WHEN outcome='success' THEN 0 WHEN outcome='empty' THEN least(streak+1,6) ELSE streak END;
    delay := CASE WHEN match_status IN ('live','on_court') THEN interval '4 minutes'
      WHEN completed>=now()-interval '24 hours' THEN interval '15 minutes'
      WHEN outcome='empty' THEN least(interval '7 days',interval '6 hours'*power(2,greatest(streak-1,0)))
      ELSE interval '6 hours' END;
    UPDATE public.match_stats_fetch_state SET last_outcome=outcome,last_attempt_at=now(),
      empty_attempts=streak,next_attempt_at=now()+delay WHERE match_id=mid;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.record_match_stats_outcomes(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_match_stats_outcomes(jsonb) TO service_role;
