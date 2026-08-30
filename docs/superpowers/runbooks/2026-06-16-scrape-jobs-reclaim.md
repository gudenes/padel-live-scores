# scrape-jobs retention reclaim — runbook (Pass 1)

One-time rollout for the scrape-jobs retention prune. Re-runnable safely.
`<MAIN_DIR>` below = `/Volumes/Crucial/dev/padel-live-scores` (has the
gitignored `.env.local` with `DATABASE_URL`). Run the node snippets from there.

## Preconditions
- Migration `20260616000001_padelgod_snapshot_scrape_job_id_indexes.sql` applied.
- `scrape-jobs-prune` worker code deployed to Railway.

## 0. Baseline audit
Record the `padelgod` schema total and per-table sizes (note `scrape_jobs`,
`results_snapshots`, `oop_snapshots`, `entry_list_snapshots`, `draw_snapshots`).
Use the same pg-driver size query used for the 2026-06-16 audit.

## 1. Apply the FK-index migration (CONCURRENTLY — standalone statements)
```bash
cd <MAIN_DIR> && node -e "
const pg=require('pg');const fs=require('fs');
const u=fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=[\"']?([^\"'\n]+)/m)[1];
const c=new pg.Client({connectionString:u,ssl:{rejectUnauthorized:false}});
const stmts=[
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_snap_scrape_job_id ON padelgod.results_snapshots (scrape_job_id)',
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oop_snap_scrape_job_id ON padelgod.oop_snapshots (scrape_job_id)',
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entry_list_snap_scrape_job_id ON padelgod.entry_list_snapshots (scrape_job_id)',
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_draw_snap_scrape_job_id ON padelgod.draw_snapshots (scrape_job_id)',
];
(async()=>{await c.connect();for(const s of stmts){console.log(s);await c.query(s);}await c.end();console.log('done');})().catch(e=>{console.error(e.message);process.exit(1);});
"
```
Verify the cascade is index-backed:
```bash
cd <MAIN_DIR> && node -e "
const pg=require('pg');const fs=require('fs');
const u=fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=[\"']?([^\"'\n]+)/m)[1];
const c=new pg.Client({connectionString:u,ssl:{rejectUnauthorized:false}});
c.connect().then(()=>c.query(\"EXPLAIN DELETE FROM padelgod.results_snapshots WHERE scrape_job_id = '00000000-0000-0000-0000-000000000000'\"))
 .then(r=>{console.log(r.rows.map(x=>x['QUERY PLAN']).join('\n'));return c.end();})
 .catch(e=>{console.error(e.message);process.exit(1);});
"
```
Expect an `Index Scan using idx_results_snap_scrape_job_id` (not a `Seq Scan`).

## 2. Prune dry-run
Set Railway env `ENABLE_SCRAPE_JOBS_PRUNE=true`, keep
`SCRAPE_JOBS_PRUNE_DRY_RUN=true`. After the 03:30 UTC run, confirm the log line
`scrape-jobs-prune [dry-run]: rows older than cutoff` reports a `candidateCount`
in the expected range (rows with `started_at` older than 14 days — on first run,
most of ~8.9M).

## 3. Prune live
Flip `SCRAPE_JOBS_PRUNE_DRY_RUN=false`. The next 03:30 UTC runs batch-delete the
backlog (cascading to the snapshot + raw_payload children). Confirm `rowsDeleted`,
`abortedEarly=false`. If `hitMaxBatches=true`, the run stopped at the batch cap —
it continues clearing on subsequent days, or raise `maxBatches` for a single pass.
Batch size is 2,000 parents/batch; watch for lock/timeout warnings.

## 4. One-time VACUUM FULL (returns disk)
Plain DELETE does not shrink the on-disk files. After the backlog is deleted, run
once in a low-activity window. These tables are written by Railway workers every
~5 min and `VACUUM FULL` takes an ACCESS EXCLUSIVE lock — either accept brief
write-blocking (workers retry next tick) or pause the relevant workers
(`results-fetcher`, `oop-fetcher`, `entry-list-fetcher`, `draw-fetcher` /
`fip-draw-fetcher`) for the duration. None are read by the user-facing app.

```bash
cd <MAIN_DIR> && node -e "
const pg=require('pg');const fs=require('fs');
const u=fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=[\"']?([^\"'\n]+)/m)[1];
const c=new pg.Client({connectionString:u,ssl:{rejectUnauthorized:false}});
const tbls=['scrape_jobs','results_snapshots','oop_snapshots','entry_list_snapshots','draw_snapshots'];
(async()=>{await c.connect();for(const t of tbls){console.log('VACUUM FULL padelgod.'+t);await c.query('VACUUM FULL padelgod.'+t);await c.query('ANALYZE padelgod.'+t);}await c.end();console.log('done');})().catch(e=>{console.error(e.message);process.exit(1);});
"
```
`VACUUM FULL` cannot run inside a transaction — `client.query` runs it directly, which is correct.

> **Also reclaim `raw_payloads` in the same window.** This worker's cascade deletes
> `raw_payloads` rows too, so the first big backlog prune leaves substantial dead
> tuples there. The list above intentionally omits it — run the
> [raw_payloads reclaim runbook](2026-05-29-raw-payloads-reclaim.md) (its step 4
> `VACUUM FULL padelgod.raw_payloads`) in the same low-activity window, or you'll
> see less disk reclaimed than expected until that table is also vacuumed.

## 5. Verify
Re-run the baseline size query. Expect the `padelgod` schema well under the 20 GB
baseline (~2 GB target) once raw_payloads (separate 14d prune) is also reclaimed.

## 6. Post-prune metrics gate (before any compute downgrade)
While STILL on Medium compute, confirm the fix landed:
- Re-run the `pg_stat_statements` top-queries probe — the `results_snapshots` /
  `oop_snapshots` / `entry_list_snapshots` reads should drop from 100–330 ms mean
  to single-digit ms.
- In Supabase Reports → Database, confirm Memory usage and cache-hit pressure fall.

Only once these confirm headroom: downgrade Medium → Small in the dashboard, watch
metrics for a few days, then optionally open a Supabase support ticket to shrink
the provisioned disk (it does not auto-shrink). The downgrade is reversible in
~2 min with no data loss.

## Rollback
- Disable prune: set `ENABLE_SCRAPE_JOBS_PRUNE=false`.
Deleted rows are unrecoverable but are write-only ledger/debug artifacts with no
app consumer — nothing to restore. The FK indexes are harmless to leave in place.
