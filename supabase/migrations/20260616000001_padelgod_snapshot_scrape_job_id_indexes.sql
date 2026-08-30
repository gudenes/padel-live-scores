-- FK-supporting indexes so ON DELETE CASCADE from padelgod.scrape_jobs to the
-- four snapshot tables uses an index lookup instead of a sequential scan.
-- Without these, pruning scrape_jobs (millions of rows) would seq-scan each
-- multi-million-row child table per parent delete. raw_payloads already has
-- idx_raw_payloads_job; scrape_jobs.started_at is already indexed.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Apply this
-- migration via the pg-driver method (DATABASE_URL), running each statement
-- standalone — NOT `supabase db push` (repo migrations have drift). See the
-- repo-migration-apply-method note and the scrape-jobs reclaim runbook.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_snap_scrape_job_id
  ON padelgod.results_snapshots (scrape_job_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oop_snap_scrape_job_id
  ON padelgod.oop_snapshots (scrape_job_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entry_list_snap_scrape_job_id
  ON padelgod.entry_list_snapshots (scrape_job_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_draw_snap_scrape_job_id
  ON padelgod.draw_snapshots (scrape_job_id);
