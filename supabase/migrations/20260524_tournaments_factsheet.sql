-- Tournaments: factsheet PDF ingest columns.
--
-- Some FIP events publish a structured PDF factsheet on the event page
-- (prize money breakdown, per-round points, daily schedule, venue address,
-- sponsors, etc.) instead of putting that info in the event page body. We
-- detect the URL via the fip-event-page-enricher worker, then a separate
-- Vercel cron (/api/cron/process-factsheets) ML-extracts the structured
-- content via the Claude API and writes it to factsheet_data.
--
-- See docs/superpowers/specs/ ... (none yet — this is a quick-strike feature)

BEGIN;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS factsheet_url TEXT,
  ADD COLUMN IF NOT EXISTS factsheet_data JSONB,
  ADD COLUMN IF NOT EXISTS factsheet_processed_at TIMESTAMPTZ;

-- The processor needs an index to efficiently pick up the queue of
-- "URL present, not yet processed" rows. Cheap partial index.
CREATE INDEX IF NOT EXISTS idx_tournaments_factsheet_pending
  ON tournaments (factsheet_url)
  WHERE factsheet_url IS NOT NULL AND factsheet_processed_at IS NULL;

COMMENT ON COLUMN tournaments.factsheet_url IS
  'URL of the FIP factsheet PDF, detected from the event page. Null when not published.';
COMMENT ON COLUMN tournaments.factsheet_data IS
  'Structured fields extracted from the factsheet PDF via Claude. Shape: { prize_money[], points[], schedule[], venue, draw_size, sponsors[] } — all keys optional.';
COMMENT ON COLUMN tournaments.factsheet_processed_at IS
  'Last successful processing time. Re-process when factsheet_url changes (set this to NULL).';

COMMIT;
