-- Cascade `padelgod.scrape_jobs.tournament_id` so that deleting a
-- tournament row also drops its scrape audit trail (and through
-- scrape_jobs' own ON DELETE CASCADE, the raw_payloads bodies).
--
-- The original FK was created without ON DELETE behaviour (default
-- RESTRICT). That blocked the 2026-05-25 orphan-tournament cleanup:
-- every DELETE on public.tournaments bounced on the FK, so the cleanup
-- had to walk every dependent table in a custom order, and even then
-- the un-indexed cascade from scrape_jobs → raw_payloads exceeded
-- PostgREST's statement timeout.
--
-- ON DELETE CASCADE matches the semantics of the sibling
-- padelgod.*_snapshots FKs (which already cascade). After this
-- migration applies, `DELETE FROM public.tournaments WHERE id = X`
-- is a single self-contained operation.

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'padelgod'
    AND t.relname = 'scrape_jobs'
    AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) LIKE '%tournament_id%REFERENCES%public.tournaments%';

  IF fk_name IS NULL THEN
    RAISE EXCEPTION 'scrape_jobs.tournament_id FK not found';
  END IF;

  EXECUTE format('ALTER TABLE padelgod.scrape_jobs DROP CONSTRAINT %I', fk_name);
END $$;

ALTER TABLE padelgod.scrape_jobs
  ADD CONSTRAINT scrape_jobs_tournament_id_fkey
  FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- Verification: confirm the new constraint cascades.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'padelgod'
      AND t.relname = 'scrape_jobs'
      AND c.conname = 'scrape_jobs_tournament_id_fkey'
      AND c.confdeltype = 'c' -- 'c' = CASCADE
  ), 'scrape_jobs_tournament_id_fkey is not ON DELETE CASCADE after migration';
END $$;
