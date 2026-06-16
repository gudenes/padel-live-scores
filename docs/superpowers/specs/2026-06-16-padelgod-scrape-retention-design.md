# padelgod scrape-jobs retention + reclaim — design

**Date:** 2026-06-16
**Status:** approved (design), pending implementation plan
**Branch:** `feat/padelgod-scrape-retention`

## Problem

The Supabase database is **~20 GB**, of which **~99% is the `padelgod` scrape pipeline's
debug/telemetry archive** — data no end user ever reads. The user-facing `public` schema is
only ~255 MB. This bloat is the root cause of both the cost and the performance complaints:

- **Cost:** the project sits on a **Medium compute add-on** (~$50/mo net of the $10 credit),
  the single biggest line item (~$86/mo projected bill). The Medium tier is held there by
  **RAM** (3.74 / 4 GB used), and the RAM is full because Postgres is caching the 20 GB of
  archive tables. CPU (~42%), IOPS (~76), disk (~$3.26) are all trivial.
- **Performance:** `pg_stat_statements` shows the **top 3 queries by total time are 75% of all
  database work** — every one is a padelgod worker scanning a bloated, unpruned table
  (`results_snapshots` read = 55% at ~331 ms mean; `oop_snapshots` ~145 ms; `entry_list_snapshots`
  ~108 ms). They are slow purely because the tables have millions of rows. The earlier upgrade to
  Medium masked this by giving enough RAM to cache the bloat; it did not fix the cause.

Shrinking the archive fixes both at once: the heavy queries get ~10–50× faster and the working
set drops to ~1–2 GB, which fits comfortably in a smaller (Small / 2 GB) compute tier — enabling a
**~$45/mo** downgrade once verified.

### Current size (measured 2026-06-16)

| Table | Total size | Est. rows | Retention today |
|---|---|---|---|
| `padelgod.raw_payloads` | 13 GB | 1.29M | 14d prune + dedup-at-write (exists) |
| `padelgod.scrape_jobs` | 5.4 GB | 8.9M | **none** |
| `padelgod.results_snapshots` | 1.76 GB | 6.5M | **none** |
| `padelgod.oop_snapshots` | 762 MB | 2.3M | **none** |
| `padelgod.entry_list_snapshots` | 653 MB | 2.5M | **none** |
| `padelgod.draw_snapshots` | 351 MB | 1.1M | **none** |
| `public` schema (the app) | 255 MB | — | n/a |

`raw_payloads` already has a retention worker (`raw-payloads-prune`, 14d) + dedup
(`raw_payload_latest`) + a reclaim runbook (`docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md`).
The 13 GB persists only because the one-time `VACUUM FULL` reclaim has not been run. The other five
tables have **no retention at all**.

## Goal & scope

**Goal:** bound the growth of `scrape_jobs` and the four snapshot tables, and reclaim the existing
backlog to disk, taking the `padelgod` schema from ~20 GB toward ~2 GB.

**In scope:** age-based retention pruning (14-day window) + a one-time backlog reclaim.

**Out of scope (deliberate, YAGNI):**
- Snapshot **dedup-at-write** (content-hash skip-unchanged on the 4 fetchers). Retention alone
  achieves the cost/perf goal; dedup adds schema columns + write-path changes on 4 workers for
  marginal extra savings. Can be added later if steady-state size warrants.
- The compute-tier downgrade itself (a dashboard action the operator takes after verifying the
  post-prune metrics) and any provisioned-disk reconfigure (Supabase support ticket).
- Any change to the user-facing app or `public` schema.

## Key facts that shape the design

1. **Cascade structure.** All four snapshot tables **and** `raw_payloads` declare
   `scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE`
   (`supabase/migrations/20260420000013_padelgod_static_snapshot_tables.sql`,
   `…20260420000010_padelgod_schema_payloads_unresolved.sql`). A snapshot is inserted synchronously
   during its scrape job, so `snapshot.captured_at ≈ scrape_job.started_at` (within seconds) and a
   snapshot can never be older than its parent job. **Therefore pruning `scrape_jobs` by
   `started_at` cascade-deletes all temporally-aligned children in one operation.**

2. **Missing FK indexes.** `scrape_jobs (started_at DESC)` and `raw_payloads (scrape_job_id)` are
   indexed, but **the four snapshot tables have NO index on `scrape_job_id`** (only `captured_at`
   and `(tournament_id, …)` composites). An `ON DELETE CASCADE` against an un-indexed FK column
   does a **sequential scan of the child table per parent delete** — unusable at 6.5M rows. The
   FK-index migration (Phase 1) is mandatory before any `scrape_jobs` prune.

3. **Consumers only read recent rows.** Every writer reads the *latest* snapshot per key
   (`fip-results-writer` uses a 24h lookback; others dedup latest-per-(tournament,key) — see
   `fip-results-writer.ts`, `fip-oop-writer.ts`, `fip-draw-populator.ts`,
   `fip-entry-list-populator.ts`). Nothing re-reads aged rows. There is **no `processed`/`consumed`
   flag** to honor. A 14-day window is ≫ the ~24h consumers need → **age-based retention is
   provably safe**.

4. **`scrape_jobs` is a write-only ledger.** No worker reads historical job rows after the fact
   (`scrape-job.ts` writes them; the only reads fetch back the just-inserted id). Safe to prune by
   age.

5. **Proven pattern to mirror:** `padelgod/src/workers/raw-payloads-prune.ts` +
   `padelgod/src/__tests__/workers/raw-payloads-prune.test.ts` + scheduler wiring at
   `padelgod/src/scheduler.ts` (flag `enableRawPayloadsPrune`, dry-run-safe default, cron
   `0 3 * * *`).

## Approach (chosen: cascade-driven single worker)

Prune **only `scrape_jobs`** by `started_at`; let the existing `ON DELETE CASCADE` clean the four
snapshot tables and `raw_payloads`. One worker, one scan target, perfectly aligned windows.

Rejected alternatives:
- **Per-table direct prune** (5 workers / 1 parameterized worker, each by its own `captured_at`):
  more moving parts, *and still requires the FK indexes* — because any `scrape_jobs` delete triggers
  the cascade-check against children regardless. No benefit while all windows are 14d.
- **App-level ordered delete** (no cascade): most code, most ordering pitfalls, no upside.

## Design — three phases (sequenced)

### Phase 1 — FK-index migration (enables fast cascade)

New migration adding, for each of `results_snapshots`, `oop_snapshots`, `entry_list_snapshots`,
`draw_snapshots`:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_<table>_scrape_job_id
  ON padelgod.<table> (scrape_job_id);
```

- `CONCURRENTLY` → no table lock (workers keep writing during creation). `CONCURRENTLY` cannot run
  inside a transaction block, so the migration is applied via the repo's **pg-driver + DATABASE_URL**
  method, **not** `supabase db push` (see `repo-migration-apply-method` memory / runbook). Each
  statement runs standalone.
- Ongoing cost: four small (uuid) indexes maintained on insert — negligible, and the tables shrink
  ~10–50× after Phase 3 anyway.
- Verification: confirm an index-backed plan for cascade deletes (`EXPLAIN` a sample
  `DELETE FROM padelgod.scrape_jobs WHERE id = …`).

### Phase 2 — `scrape-jobs-prune` worker (ongoing, bounds growth)

New worker `padelgod/src/workers/scrape-jobs-prune.ts`, near-identical to `raw-payloads-prune.ts`:

- Selects `scrape_jobs.id` where `started_at < now − retentionDays` in id-batches, deletes by
  `.in('id', ids)`; cascade removes children.
- **Defaults:** `retentionDays = 14`, **`batchSize = 2000`** (smaller than raw-payloads' 10k because
  each parent fans out to many cascaded child rows — keeps per-batch lock/transaction bounded),
  `maxBatches = 500`, `dryRun` required.
- **Result shape** (mirror): `cutoffIso`, `candidateCount`, `rowsDeleted` (parent jobs deleted),
  `batchesRun`, `hitMaxBatches`, `abortedEarly`, `dryRun`.
- **Error handling:** fail-closed on select/delete error → set `abortedEarly`, break (no partial
  silent loss). `maxBatches` backstop. Deletes are irrecoverable but these are write-only debug
  artifacts with no app consumer.
- **Scheduler wiring** (`scheduler.ts`): import; add `enableScrapeJobsPrune` +
  `scrapeJobsPruneDryRun` to `SchedulerFlags` (dry-run-safe default); register in `buildSchedule()`
  behind the flag with the dry-run flag threaded via closure; add to the worker-name union +
  admin-trigger map (dry-run-safe default for manual trigger). Cron **`30 3 * * *`** (daily, 30 min
  after the 03:00 raw-payloads prune, off-hours).

**Relationship to `raw-payloads-prune`:** the cascade would also clean `raw_payloads`, so this
worker technically subsumes it. We **keep `raw-payloads-prune` as-is** — at the same 14d window both
target identical rows (whichever runs first wins; the other finds nothing), so it is harmless
defense-in-depth and its dedup pairing stays conceptually intact. No change to existing raw-payloads
code.

### Phase 3 — one-time backlog reclaim (returns disk)

A runbook `docs/superpowers/runbooks/2026-06-16-scrape-jobs-reclaim.md`, mirroring the raw-payloads
reclaim:

1. **Baseline audit** — record `padelgod` schema + per-table sizes (pg-driver size query).
2. **Dry-run** — `ENABLE_SCRAPE_JOBS_PRUNE=true`, `SCRAPE_JOBS_PRUNE_DRY_RUN=true`; confirm
   `candidateCount` ≈ rows with `started_at` older than 14 days (first run: most of ~8.9M).
3. **Live prune** — flip dry-run false. The backlog clears over one or more daily runs (or raise
   `maxBatches` for a single pass). Confirm `abortedEarly=false`; note `hitMaxBatches`.
4. **`VACUUM FULL` + `ANALYZE`** on `scrape_jobs` and the four snapshot tables, in a low-activity
   window, to return disk to the OS (plain DELETE does not shrink the file). **Caveat:** these
   tables are written by Railway workers every ~5 min and `VACUUM FULL` takes an `ACCESS EXCLUSIVE`
   lock — either accept brief write-blocking (workers retry next tick) or pause the relevant Railway
   workers for the duration. They are never read by the user-facing app.
5. **Verify** — re-measure; expect `padelgod` schema well under the 20 GB baseline (~2 GB target).
6. **Post-prune metrics check (gates the downgrade)** — while still on Medium, re-run the
   `pg_stat_statements` top-queries probe and observe RAM/cache-hit ratio. Expect the snapshot-read
   means to drop to single-digit ms and memory pressure to fall. Only then is the Medium→Small
   downgrade safe.

**Rollback:** set `ENABLE_SCRAPE_JOBS_PRUNE=false`. Deleted rows are unrecoverable but are
write-only debug artifacts with no consumer — nothing to restore. The FK indexes are harmless to
leave in place even if pruning is disabled.

## Testing

- **Unit test** `scrape-jobs-prune.test.ts` mirroring `raw-payloads-prune.test.ts`: fake Supabase
  chain (`.schema().from().select().lt().limit()` → batches; `.delete().in()` → count); assert
  multi-batch delete sequence, empty-result stop, dry-run counts-without-deleting,
  `hitMaxBatches` at the cap, and `abortedEarly` on a delete error.
- **Migration + reclaim** validated operationally via the runbook (dry-run + before/after size
  audit + `EXPLAIN` confirming index-backed cascade). Not unit-tested.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cascade slow without FK index | Phase 1 migration is a hard prerequisite; verify with `EXPLAIN`. |
| Large cascade per batch (lock pressure) | `batchSize = 2000`; daily off-hours cron; `maxBatches` cap. |
| Pruning a row a consumer still needs | 14d ≫ 24h consumer lookback; latest-per-key reads; aligned `captured_at ≈ started_at`. |
| `VACUUM FULL` lock vs live workers | Low-activity window; optionally pause Railway workers; tables not read by app. |
| Accidental over-delete | Dry-run-safe defaults everywhere; runbook requires dry-run confirmation before live. |
| Other sessions' commits in shared dir | All work isolated in `feat/padelgod-scrape-retention` worktree. |

## Expected outcome

`padelgod` schema ~20 GB → ~2 GB; top snapshot queries ~10–50× faster; RAM pressure relieved →
Medium→Small compute downgrade becomes safe (~$45/mo saving; bill ~$86 → ~$40).
