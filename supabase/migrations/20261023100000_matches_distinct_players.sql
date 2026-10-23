-- Last line of defence for every ingestion path, manual repair and merge.
-- Do not use a NOT VALID CHECK: PostgreSQL still checks it on every UPDATE,
-- which would break score/schedule writes on the remaining historical rows.
CREATE OR REPLACE FUNCTION public.guard_match_distinct_players()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  player_ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.pair1_player1_id, NEW.pair1_player2_id, NEW.pair2_player1_id, NEW.pair2_player2_id)
       IS NOT DISTINCT FROM
       ROW(OLD.pair1_player1_id, OLD.pair1_player2_id, OLD.pair2_player1_id, OLD.pair2_player2_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  player_ids := array_remove(ARRAY[
    NEW.pair1_player1_id, NEW.pair1_player2_id,
    NEW.pair2_player1_id, NEW.pair2_player2_id
  ], NULL);
  IF cardinality(player_ids) <> (SELECT count(DISTINCT id) FROM unnest(player_ids) AS p(id)) THEN
    RAISE EXCEPTION 'A player cannot occupy multiple slots in the same match'
      USING ERRCODE = '23514', CONSTRAINT = 'matches_distinct_player_ids';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zz_matches_distinct_players
BEFORE INSERT OR UPDATE OF pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id
ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.guard_match_distinct_players();
