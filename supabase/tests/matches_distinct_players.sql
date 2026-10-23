-- Run after the migration: psql -v ON_ERROR_STOP=1 -f this-file.sql
-- All fixtures live in a temporary table; no application rows are changed.
BEGIN;
CREATE TEMP TABLE match_identity_test (
  id integer PRIMARY KEY,
  pair1_player1_id uuid, pair1_player2_id uuid,
  pair2_player1_id uuid, pair2_player2_id uuid,
  status text DEFAULT 'scheduled'
);

-- Legacy duplicates must remain writable for non-lineup maintenance.
INSERT INTO match_identity_test VALUES (1,
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
  NULL, NULL, 'scheduled');

CREATE TRIGGER identity_guard
BEFORE INSERT OR UPDATE OF pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id
ON match_identity_test FOR EACH ROW EXECUTE FUNCTION public.guard_match_distinct_players();

DO $$
DECLARE
  a uuid := '00000000-0000-0000-0000-000000000001';
  b uuid := '00000000-0000-0000-0000-000000000002';
  c uuid := '00000000-0000-0000-0000-000000000003';
  d uuid := '00000000-0000-0000-0000-000000000004';
BEGIN
  INSERT INTO match_identity_test VALUES (2, a, b, c, d, 'scheduled');
  INSERT INTO match_identity_test (id) VALUES (3); -- repeated NULL is valid
  UPDATE match_identity_test SET status='finished' WHERE id=1;
  UPDATE match_identity_test SET pair1_player1_id=a WHERE id=1; -- unchanged legacy IDs

  BEGIN
    INSERT INTO match_identity_test VALUES (4, a, a, c, d, 'scheduled');
    RAISE EXCEPTION 'accepted duplicate teammates';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO match_identity_test VALUES (4, a, b, a, d, 'scheduled');
    RAISE EXCEPTION 'accepted a player on both teams';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE match_identity_test SET pair1_player2_id=a WHERE id=2;
    RAISE EXCEPTION 'accepted a colliding partial update';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Atomic swaps and corrections remain allowed.
  UPDATE match_identity_test SET pair1_player1_id=b, pair1_player2_id=a WHERE id=2;
  UPDATE match_identity_test SET pair1_player2_id=b WHERE id=1;
  UPDATE match_identity_test SET pair1_player2_id=NULL WHERE id=1;
  IF (SELECT pair1_player1_id FROM match_identity_test WHERE id=2) <> b THEN
    RAISE EXCEPTION 'atomic swap failed';
  END IF;
END;
$$;
ROLLBACK;
