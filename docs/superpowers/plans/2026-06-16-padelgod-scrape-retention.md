# padelgod scrape-jobs Retention + Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the growth of `padelgod.scrape_jobs` (and, via `ON DELETE CASCADE`, the four snapshot tables) with a 14-day retention prune worker, plus the FK indexes and one-time reclaim that make it fast and recover the ~18 GB backlog.

**Architecture:** A single `scrape-jobs-prune` worker batch-deletes `scrape_jobs` rows older than 14 days by `started_at`; the existing `ON DELETE CASCADE` FKs remove the matching `results_snapshots` / `oop_snapshots` / `entry_list_snapshots` / `draw_snapshots` / `raw_payloads` children automatically. A prerequisite migration adds `(scrape_job_id)` indexes on the four snapshot tables so the cascade is an index lookup, not a seq scan. The worker mirrors the proven `raw-payloads-prune` (dry-run-safe, batched, `maxBatches` backstop). A runbook covers the one-time backlog prune + `VACUUM FULL`.

**Tech Stack:** TypeScript, Node, Supabase JS client (service key), node-cron (padelgod scheduler), vitest, Zod env parsing, PostgreSQL.

**Spec:** [docs/superpowers/specs/2026-06-16-padelgod-scrape-retention-design.md](../specs/2026-06-16-padelgod-scrape-retention-design.md)

**Working directory for all commands:** `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/scrape-retention` (the isolated `feat/padelgod-scrape-retention` worktree). Branch must stay `feat/padelgod-scrape-retention`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `padelgod/src/workers/scrape-jobs-prune.ts` | The retention worker (pure fn over a Supabase client). | Create |
| `padelgod/src/__tests__/workers/scrape-jobs-prune.test.ts` | Unit tests (fake Supabase). | Create |
| `padelgod/src/lib/env.ts` | Add `ENABLE_SCRAPE_JOBS_PRUNE` + `SCRAPE_JOBS_PRUNE_DRY_RUN` env flags. | Modify |
| `padelgod/src/scheduler.ts` | Import worker; add flags, worker-name, admin-trigger case, schedule entry. | Modify |
| `padelgod/src/index.ts` | Map the two new env vars into `SchedulerFlags`. | Modify |
| `supabase/migrations/20260616000001_padelgod_snapshot_scrape_job_id_indexes.sql` | FK-supporting indexes on the 4 snapshot tables. | Create |
| `docs/superpowers/runbooks/2026-06-16-scrape-jobs-reclaim.md` | One-time backlog prune + VACUUM FULL + downgrade gate. | Create |

---

## Task 1: `scrape-jobs-prune` worker (TDD)

Mirrors `padelgod/src/workers/raw-payloads-prune.ts` exactly, with three changes: table `scrape_jobs`, timestamp column `started_at`, default `batchSize = 2000` (smaller than raw-payloads' 10k because each parent delete cascades to many child rows).

**Files:**
- Create: `padelgod/src/workers/scrape-jobs-prune.ts`
- Test: `padelgod/src/__tests__/workers/scrape-jobs-prune.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/__tests__/workers/scrape-jobs-prune.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runScrapeJobsPrune } from '../../workers/scrape-jobs-prune.js';

// Stub supabase whose `from('scrape_jobs')` builder is thenable.
// `selectBatches` are the successive id arrays returned by select().lt().limit();
// `countValue` is returned for the head-count select used in dry-run.
function fakeSupabase(selectBatches: string[][], countValue = 0, deleteError?: string) {
  const deletedBatches: string[][] = [];
  let idx = 0;
  return {
    deletedBatches,
    schema: (_s: string) => ({
      from: (_t: string) => {
        const state: any = { op: null, head: false };
        const builder: any = {
          select: (_c: string, o?: any) => { state.op = 'select'; if (o?.head) state.head = true; return builder; },
          delete: (_o?: any) => { state.op = 'delete'; return builder; },
          lt: () => builder,
          in: (_c: string, ids: string[]) => { state.ids = ids; return builder; },
          limit: () => builder,
          then: (resolve: any) => {
            if (state.op === 'select' && state.head) return resolve({ count: countValue, error: null });
            if (state.op === 'select') { const b = selectBatches[idx] ?? []; idx++; return resolve({ data: b.map((id) => ({ id })), error: null }); }
            if (state.op === 'delete') {
              if (deleteError) return resolve({ count: null, error: { message: deleteError } });
              deletedBatches.push(state.ids); return resolve({ count: state.ids.length, error: null });
            }
            return resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    }),
  };
}

describe('runScrapeJobsPrune', () => {
  it('deletes rows older than cutoff across batches', async () => {
    const sb = fakeSupabase([['a', 'b'], ['c']]);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.rowsDeleted).toBe(3);
    expect(res.batchesRun).toBe(2);
    expect(sb.deletedBatches).toEqual([['a', 'b'], ['c']]);
    expect(res.hitMaxBatches).toBe(false);
  });

  it('does nothing when no rows are older than cutoff', async () => {
    const sb = fakeSupabase([[]]);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.rowsDeleted).toBe(0);
    expect(res.batchesRun).toBe(0);
    expect(sb.deletedBatches).toEqual([]);
  });

  it('dry-run reports candidate count and deletes nothing', async () => {
    const sb = fakeSupabase([], 42);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: true });
    expect(res.candidateCount).toBe(42);
    expect(res.rowsDeleted).toBe(0);
    expect(sb.deletedBatches).toEqual([]);
  });

  it('stops at maxBatches and flags it', async () => {
    const sb = fakeSupabase([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 2 });
    expect(res.batchesRun).toBe(2);
    expect(res.rowsDeleted).toBe(4);
    expect(res.hitMaxBatches).toBe(true);
  });

  it('aborts early and flags it when a delete batch errors', async () => {
    const sb = fakeSupabase([['a', 'b']], 0, 'delete boom');
    const res = await runScrapeJobsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.abortedEarly).toBe(true);
    expect(res.rowsDeleted).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/workers/scrape-jobs-prune.test.ts`
Expected: FAIL — cannot resolve `../../workers/scrape-jobs-prune.js` (module does not exist yet).

- [ ] **Step 3: Write the worker**

Create `padelgod/src/workers/scrape-jobs-prune.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * scrape-jobs-prune
 *
 * Retention sweeper for padelgod.scrape_jobs — a write-only operational
 * ledger (no worker reads historical job rows). Deletes rows older than
 * retentionDays in id-batches to avoid long locks / statement timeouts.
 *
 * Every snapshot table (results/oop/entry_list/draw_snapshots) AND
 * raw_payloads reference scrape_jobs(id) via ON DELETE CASCADE, and a
 * snapshot is born in the same job run (snapshot.captured_at ≈
 * scrape_job.started_at). So deleting a scrape_jobs row older than the
 * cutoff cascade-deletes its temporally-aligned children — this single
 * worker bounds all six tables. Consumers only ever read the latest
 * snapshot per key (≤24h lookback), so a 14d window never strands a row
 * a consumer still needs.
 *
 * REQUIRES the FK-supporting indexes on the four snapshot tables
 * (migration 20260616000001) — without them each cascade delete
 * seq-scans the child tables.
 *
 * Recurring daily prune uses plain DELETE; autovacuum reuses the freed
 * space so steady-state stays flat. The existing backlog is reclaimed to
 * disk by a one-time VACUUM FULL (see the reclaim runbook), NOT by this
 * worker.
 *
 * batchSize defaults to 2,000 (smaller than raw-payloads-prune's 10k)
 * because each parent delete fans out to many cascaded child rows.
 */

export interface ScrapeJobsPruneDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** Delete rows older than this many days. Default 14. */
  retentionDays?: number;
  /** Rows per delete batch. Default 2,000. */
  batchSize?: number;
  /** Safety cap on batches per run. Default 500. */
  maxBatches?: number;
  /** When true, only count candidates; delete nothing. */
  dryRun: boolean;
}

export interface ScrapeJobsPruneResult {
  cutoffIso: string;
  candidateCount: number;
  rowsDeleted: number;
  batchesRun: number;
  /** True when the run stopped because it reached the maxBatches cap.
   *  More rows may still be older than the cutoff — re-run, or raise
   *  maxBatches to clear them in one pass. Does not guarantee rows remain. */
  hitMaxBatches: boolean;
  /** True when the loop stopped because a select/delete batch errored
   *  (partial run). Distinguishes an error-aborted run from clean
   *  completion in the logged result. */
  abortedEarly: boolean;
  dryRun: boolean;
}

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_BATCH_SIZE = 2_000;
const DEFAULT_MAX_BATCHES = 500;

export async function runScrapeJobsPrune(
  deps: ScrapeJobsPruneDeps,
): Promise<ScrapeJobsPruneResult> {
  const { supabase, logger, dryRun } = deps;
  const retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();

  const result: ScrapeJobsPruneResult = {
    cutoffIso,
    candidateCount: 0,
    rowsDeleted: 0,
    batchesRun: 0,
    hitMaxBatches: false,
    abortedEarly: false,
    dryRun,
  };

  if (dryRun) {
    const { count, error } = await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .select('id', { count: 'exact', head: true })
      .lt('started_at', cutoffIso);
    if (error) {
      logger?.warn({ err: error.message }, 'scrape-jobs-prune [dry-run]: count failed');
      return result;
    }
    result.candidateCount = count ?? 0;
    logger?.info(result, 'scrape-jobs-prune [dry-run]: rows older than cutoff');
    return result;
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .select('id')
      .lt('started_at', cutoffIso)
      .limit(batchSize);
    if (error) {
      logger?.warn({ err: error.message, batch }, 'scrape-jobs-prune: select batch failed');
      result.abortedEarly = true;
      break;
    }
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) break;

    const { error: delErr, count } = await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .delete({ count: 'exact' })
      .in('id', ids);
    if (delErr) {
      logger?.warn({ err: delErr.message, batch }, 'scrape-jobs-prune: delete batch failed');
      result.abortedEarly = true;
      break;
    }

    result.rowsDeleted += count ?? ids.length;
    result.batchesRun += 1;
    if (ids.length < batchSize) break;        // last partial batch
    if (batch === maxBatches - 1) result.hitMaxBatches = true;
  }

  logger?.info(result, 'scrape-jobs-prune: done');
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/workers/scrape-jobs-prune.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/scrape-retention
git add padelgod/src/workers/scrape-jobs-prune.ts padelgod/src/__tests__/workers/scrape-jobs-prune.test.ts
git commit -m "feat(padelgod): scrape-jobs-prune retention worker (cascade-driven, 14d)"
```

---

## Task 2: Wire the worker into env + scheduler + index

These three files must change together — `SchedulerFlags` gains two required fields, so `index.ts` must populate them or TypeScript fails to compile. Verified together by a build check at the end.

**Files:**
- Modify: `padelgod/src/lib/env.ts` (after the `RAW_PAYLOADS_PRUNE_DRY_RUN` block, ~line 184)
- Modify: `padelgod/src/scheduler.ts` (import ~line 7; flags interface ~line 106; `WorkerName` union ~line 197; `ALL_WORKERS` ~line 235; admin-trigger case ~line 371; `buildSchedule` ~line 796)
- Modify: `padelgod/src/index.ts` (flags object ~line 171)

- [ ] **Step 1: Add env flags**

In `padelgod/src/lib/env.ts`, immediately after the line `RAW_PAYLOADS_PRUNE_DRY_RUN: boolEnv(true),` (the closing line of the raw-payloads-prune block, ~line 184), insert:

```typescript
  // scrape-jobs-prune — deletes `padelgod.scrape_jobs` rows older than the
  // retention window (default 14 days). ON DELETE CASCADE removes the
  // matching results/oop/entry_list/draw snapshot + raw_payload children.
  // Runs daily at 03:30 UTC, after raw-payloads-prune. Default OFF —
  // operator flips on in Railway AFTER migration 20260616000001 (the FK
  // indexes) is applied and a dry-run has been reviewed.
  ENABLE_SCRAPE_JOBS_PRUNE: boolEnv(false),
  // Dry-run: when true (default), logs how many rows would be deleted but
  // makes no DB writes. Flip to false once the first day's dry-run output
  // looks correct.
  SCRAPE_JOBS_PRUNE_DRY_RUN: boolEnv(true),
```

- [ ] **Step 2: Import the worker in scheduler.ts**

In `padelgod/src/scheduler.ts`, immediately after the line `import { runRawPayloadsPrune } from './workers/raw-payloads-prune.js';` (line 7), insert:

```typescript
import { runScrapeJobsPrune } from './workers/scrape-jobs-prune.js';
```

- [ ] **Step 3: Add flags to the `SchedulerFlags` interface**

In `padelgod/src/scheduler.ts`, immediately after the `rawPayloadsPruneDryRun: boolean;` field (line 106), insert:

```typescript
  enableScrapeJobsPrune: boolean;
  /** Same dry-run semantics as the other prune workers. Defaults to true
   *  for safety; flip in Railway once the first run's dry-run output
   *  is reviewed. */
  scrapeJobsPruneDryRun: boolean;
```

- [ ] **Step 4: Add to the `WorkerName` union and `ALL_WORKERS` array**

In `padelgod/src/scheduler.ts`, in the `WorkerName` union, immediately after the `| 'raw-payloads-prune'` line (line 197), insert:

```typescript
  | 'scrape-jobs-prune'
```

Then in the `ALL_WORKERS` array, immediately after the `'raw-payloads-prune',` entry (line 235), insert:

```typescript
  'scrape-jobs-prune',
```

- [ ] **Step 5: Add the admin-trigger case**

In `padelgod/src/scheduler.ts`, immediately after the `raw-payloads-prune` admin-trigger case closing (the `});` on line 371, right before `case 'schedule-hints-writer':`), insert:

```typescript
    case 'scrape-jobs-prune':        return (deps) => runScrapeJobsPrune({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger dry-run-SAFE default. Scheduled cron threads the
      // real env flag via closure (see buildSchedule below).
      dryRun: true,
    });
```

- [ ] **Step 6: Add the schedule entry in `buildSchedule`**

In `padelgod/src/scheduler.ts`, immediately after the `raw-payloads-prune` schedule block closes (the `}` on line 796, right before `if (flags.enableScheduleHintsWriter) {`), insert:

```typescript
  if (flags.enableScrapeJobsPrune) {
    entries.push({
      name: 'scrape-jobs-prune',
      // Daily at 03:30 UTC (off-hours), 30 min after raw-payloads-prune.
      // Batched DELETE of scrape_jobs rows older than the retention window;
      // ON DELETE CASCADE removes the snapshot + raw_payload children.
      // DB-only, no external calls.
      cron: '30 3 * * *',
      run: async (deps) => {
        return runScrapeJobsPrune({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.scrapeJobsPruneDryRun,
        });
      },
    });
  }
```

- [ ] **Step 7: Map the env vars into flags in index.ts**

In `padelgod/src/index.ts`, immediately after the line `rawPayloadsPruneDryRun: env.RAW_PAYLOADS_PRUNE_DRY_RUN,` (line 171), insert:

```typescript
      enableScrapeJobsPrune: env.ENABLE_SCRAPE_JOBS_PRUNE,
      scrapeJobsPruneDryRun: env.SCRAPE_JOBS_PRUNE_DRY_RUN,
```

- [ ] **Step 8: Type-check / build the padelgod package**

Run: `cd padelgod && npx tsc --noEmit`
Expected: exits 0, no type errors. (If `tsc` config differs, fall back to `cd padelgod && npm run build`.)

- [ ] **Step 9: Re-run the worker test to confirm nothing regressed**

Run: `cd padelgod && npx vitest run src/__tests__/workers/scrape-jobs-prune.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 10: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/scrape-retention
git add padelgod/src/lib/env.ts padelgod/src/scheduler.ts padelgod/src/index.ts
git commit -m "feat(padelgod): wire scrape-jobs-prune into scheduler (flags + cron 03:30)"
```

---

## Task 3: FK-index migration

Adds `(scrape_job_id)` indexes on the four snapshot tables so the cascade from `scrape_jobs` is an index lookup. `raw_payloads` already has `idx_raw_payloads_job`; `scrape_jobs (started_at DESC)` already exists.

**Files:**
- Create: `supabase/migrations/20260616000001_padelgod_snapshot_scrape_job_id_indexes.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260616000001_padelgod_snapshot_scrape_job_id_indexes.sql`:

```sql
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
```

- [ ] **Step 2: Commit the migration file**

(The file is *applied* operationally in Task 5 / the runbook — this step only commits the SQL.)

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/scrape-retention
git add supabase/migrations/20260616000001_padelgod_snapshot_scrape_job_id_indexes.sql
git commit -m "feat(padelgod): FK indexes on snapshot tables for cascade-prune"
```

---

## Task 4: Reclaim runbook

A one-time operational doc mirroring `docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md`.

**Files:**
- Create: `docs/superpowers/runbooks/2026-06-16-scrape-jobs-reclaim.md`

- [ ] **Step 1: Create the runbook**

Create `docs/superpowers/runbooks/2026-06-16-scrape-jobs-reclaim.md`:

````markdown
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
````

- [ ] **Step 2: Commit the runbook**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/scrape-retention
git add docs/superpowers/runbooks/2026-06-16-scrape-jobs-reclaim.md
git commit -m "docs(padelgod): scrape-jobs reclaim runbook"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the full padelgod test suite**

Run: `cd padelgod && npx vitest run`
Expected: all tests pass (the new `scrape-jobs-prune` suite + no regressions).

- [ ] **Step 2: Type-check the padelgod package**

Run: `cd padelgod && npx tsc --noEmit`
Expected: exits 0, no type errors.

- [ ] **Step 3: Confirm the branch is clean and review the diff**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/scrape-retention
git status
git log --oneline origin/main..HEAD
```
Expected: working tree clean; commits from Tasks 1–4 present on `feat/padelgod-scrape-retention`.

---

## Notes for the implementer

- **Operational sequencing (not code):** the FK-index migration (Task 3) must be *applied* (runbook step 1) BEFORE `SCRAPE_JOBS_PRUNE_DRY_RUN` is flipped to `false`, or the first live prune will be slow. The code can be merged in any order; the runbook enforces apply-order at execution time.
- **`raw-payloads-prune` is unchanged.** It stays as-is; at the same 14d window both workers target identical rows, so it's harmless defense-in-depth.
- **Test command:** padelgod has its own vitest; run tests from inside `padelgod/`.
- **Do not commit outside this worktree.** The shared main dir's branch is switched by other sessions.
```
