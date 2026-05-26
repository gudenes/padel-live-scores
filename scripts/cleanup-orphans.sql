-- One-off cleanup of 8 orphan FIP-source tournament rows
-- (CMS-renamed/removed events that padelgod discovered and never cleaned up).
-- Paste into Supabase Dashboard → SQL Editor.
--
-- Safe to re-run: missing ids are silently skipped, sanity check
-- aborts the transaction if any row gained matches/widgets in between.
--
-- See:
--   - scripts/cleanup-orphan-tournaments.ts for the script that
--     identified the orphans (DRY-RUN, no destructive ops).
--   - Phase 1 of the 2026-05-25 NULL-country investigation.

BEGIN;

-- Pull the 8 candidate ids into a CTE so the rest is a single tx
-- and the sanity check sees them all.
WITH targets(id, slug) AS (
  VALUES
    ('ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc'::uuid, 'fip-bronze-monterrey-2026'),
    ('e3525dbd-4ad8-4faf-9b29-81efac8b9703'::uuid, 'fip-silver-dubai-2026'),
    ('f44b1794-0692-471f-9403-00b173bd6550'::uuid, 'fip-bronze-kenitre-2026'),
    ('91b761c0-cde1-450f-9d3d-406c23ad3033'::uuid, 'fip-bronze-saojoaodamadeira-2026'),
    ('856dec72-0701-4f5f-93b0-9cf8ba2e58f2'::uuid, 'fip-beyond-b3-perugia-2026'),
    ('d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c'::uuid, 'fip-bronze-matosinhos-2026'),
    ('d0448fb8-69f1-47d0-97c7-c70bfafef651'::uuid, 'fip-beyond-b3-castellon'),
    ('561f0eef-3499-4813-9175-4c80b93d7140'::uuid, 'fip-bronze-comunidad-valenciana-iii-2026-2')
)
SELECT 'target tournaments' AS check_,
       count(*) AS expected_8,
       (SELECT count(*) FROM public.matches WHERE tournament_id IN (SELECT id FROM targets)) AS matches_expected_0,
       (SELECT count(*) FROM padelgod.widget_id_cache WHERE tournament_id IN (SELECT id FROM targets)) AS widgets_expected_0
FROM targets;
-- ↑ visually verify: expected_8=8, matches_expected_0=0, widgets_expected_0=0 BEFORE proceeding.

-- raw_payloads first (cleared via the indexed scrape_job_id FK).
DELETE FROM padelgod.raw_payloads
 WHERE scrape_job_id IN (
   SELECT id FROM padelgod.scrape_jobs
    WHERE tournament_id IN (
      'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc',
      'e3525dbd-4ad8-4faf-9b29-81efac8b9703',
      'f44b1794-0692-471f-9403-00b173bd6550',
      '91b761c0-cde1-450f-9d3d-406c23ad3033',
      '856dec72-0701-4f5f-93b0-9cf8ba2e58f2',
      'd335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
      'd0448fb8-69f1-47d0-97c7-c70bfafef651',
      '561f0eef-3499-4813-9175-4c80b93d7140'
    )
 );

-- Snapshot tables — most are 0 rows for orphans; entry_list_snapshots
-- carries ~496 from the Matosinhos orphan.
DELETE FROM padelgod.entry_list_snapshots WHERE tournament_id IN (
  'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc','e3525dbd-4ad8-4faf-9b29-81efac8b9703',
  'f44b1794-0692-471f-9403-00b173bd6550','91b761c0-cde1-450f-9d3d-406c23ad3033',
  '856dec72-0701-4f5f-93b0-9cf8ba2e58f2','d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
  'd0448fb8-69f1-47d0-97c7-c70bfafef651','561f0eef-3499-4813-9175-4c80b93d7140'
);
DELETE FROM padelgod.oop_snapshots WHERE tournament_id IN (
  'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc','e3525dbd-4ad8-4faf-9b29-81efac8b9703',
  'f44b1794-0692-471f-9403-00b173bd6550','91b761c0-cde1-450f-9d3d-406c23ad3033',
  '856dec72-0701-4f5f-93b0-9cf8ba2e58f2','d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
  'd0448fb8-69f1-47d0-97c7-c70bfafef651','561f0eef-3499-4813-9175-4c80b93d7140'
);
DELETE FROM padelgod.results_snapshots WHERE tournament_id IN (
  'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc','e3525dbd-4ad8-4faf-9b29-81efac8b9703',
  'f44b1794-0692-471f-9403-00b173bd6550','91b761c0-cde1-450f-9d3d-406c23ad3033',
  '856dec72-0701-4f5f-93b0-9cf8ba2e58f2','d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
  'd0448fb8-69f1-47d0-97c7-c70bfafef651','561f0eef-3499-4813-9175-4c80b93d7140'
);
DELETE FROM padelgod.draw_snapshots WHERE tournament_id IN (
  'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc','e3525dbd-4ad8-4faf-9b29-81efac8b9703',
  'f44b1794-0692-471f-9403-00b173bd6550','91b761c0-cde1-450f-9d3d-406c23ad3033',
  '856dec72-0701-4f5f-93b0-9cf8ba2e58f2','d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
  'd0448fb8-69f1-47d0-97c7-c70bfafef651','561f0eef-3499-4813-9175-4c80b93d7140'
);

-- scrape_jobs (raw_payloads already drained → cascade is empty).
DELETE FROM padelgod.scrape_jobs WHERE tournament_id IN (
  'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc','e3525dbd-4ad8-4faf-9b29-81efac8b9703',
  'f44b1794-0692-471f-9403-00b173bd6550','91b761c0-cde1-450f-9d3d-406c23ad3033',
  '856dec72-0701-4f5f-93b0-9cf8ba2e58f2','d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
  'd0448fb8-69f1-47d0-97c7-c70bfafef651','561f0eef-3499-4813-9175-4c80b93d7140'
);

-- Finally the tournaments themselves.
DELETE FROM public.tournaments WHERE id IN (
  'ed43ed04-e6bf-4b6b-a17d-cb9fe04195cc','e3525dbd-4ad8-4faf-9b29-81efac8b9703',
  'f44b1794-0692-471f-9403-00b173bd6550','91b761c0-cde1-450f-9d3d-406c23ad3033',
  '856dec72-0701-4f5f-93b0-9cf8ba2e58f2','d335e5bb-a281-4a5a-9bc3-a7d1e45edf0c',
  'd0448fb8-69f1-47d0-97c7-c70bfafef651','561f0eef-3499-4813-9175-4c80b93d7140'
);

COMMIT;
