# raw_payloads Retention + Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Supabase storage cost by stopping duplicate `padelgod.raw_payloads` writes (skip-unchanged + 7-day heartbeat) and pruning bodies older than 14 days, then reclaiming the existing ~18 GB backlog.

**Architecture:** Two independent code components plus one one-time ops step. (1) A tiny `padelgod.raw_payload_latest` state table lets the shared `runScrapeJob` helper decide whether a freshly-scraped body is worth storing. (2) A new `raw-payloads-prune` node-cron worker batch-deletes rows older than the retention window, mirroring the existing `fip-cms-orphan-prune` worker. (3) A one-time `VACUUM FULL` returns deleted disk to Supabase's measured size.

**Tech Stack:** TypeScript, `@supabase/supabase-js` (service key, `padelgod` schema), `node-cron` scheduler, `zod` env parsing, `vitest`, raw SQL migration, `pg` for the one-time vacuum.

**Spec:** `docs/superpowers/specs/2026-05-29-raw-payloads-retention-dedup-design.md`

**Worktree:** `/Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup` (branch `cost/raw-payloads-retention-dedup`). Run all commands from this directory.

**Setup note:** the worktree has no `node_modules`. Before running tests the first time, run `cd padelgod && npm install` (the `pg`-based audit/vacuum scripts in Task 6 reference the main repo's modules and are run separately).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/20260529000001_padelgod_raw_payload_latest.sql` | Schema for the dedup state table | Create |
| `padelgod/src/lib/scrape-job.ts` | Decide store-vs-skip for each scraped body; upsert dedup state | Modify (the `captureBody` block, currently lines 53-66) |
| `padelgod/src/__tests__/scrape-job.test.ts` | Unit tests for dedup decision logic | Modify (extend `fakeSupabase`, add cases) |
| `padelgod/src/workers/raw-payloads-prune.ts` | Batched retention delete worker | Create |
| `padelgod/src/__tests__/workers/raw-payloads-prune.test.ts` | Unit tests for the prune worker | Create |
| `padelgod/src/lib/env.ts` | Declare prune enable/dry-run env vars | Modify (`EnvSchema`) |
| `padelgod/src/index.ts` | Thread env → scheduler flags | Modify (flags object, ~line 168) |
| `padelgod/src/scheduler.ts` | Register the worker (flags, union, runner, cron) | Modify (5 sites) |
| `docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md` | One-time reclaim + verification runbook | Create |

**Config split rationale:** the prune worker is a scheduler worker, so its `ENABLE_*` / `*_DRY_RUN` flags flow through `env.ts → index.ts → SchedulerFlags` like every other worker. The dedup logic lives inside `runScrapeJob`, a shared lib called by ~10 workers; threading flags through every caller is impractical, so dedup reads `process.env` directly (`RAW_PAYLOAD_DEDUP_ENABLED`, `RAW_PAYLOAD_HEARTBEAT_DAYS`). This is deliberate, not an oversight.

---

## Task 1: Migration — `padelgod.raw_payload_latest`

**Files:**
- Create: `supabase/migrations/20260529000001_padelgod_raw_payload_latest.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Supabase cost Pass 1: dedup state for padelgod.raw_payloads.
-- One row per active scrape target (job_type, target_url). The scrape
-- pipeline consults this to skip storing a body identical to the
-- target's last stored body (with a heartbeat re-store every N days).
-- Bounded: a few thousand rows; never grows with scrape history.

CREATE TABLE padelgod.raw_payload_latest (
  job_type          TEXT NOT NULL,
  target_url        TEXT NOT NULL,
  tournament_id     UUID,                 -- informational only, not in key
  last_content_hash TEXT NOT NULL,
  last_stored_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (job_type, target_url)
);

COMMENT ON TABLE padelgod.raw_payload_latest IS
  'Dedup state for raw_payloads. Latest stored content_hash + timestamp per (job_type, target_url). Written by runScrapeJob when it stores a body.';
```

- [ ] **Step 2: Apply the migration to the dev/prod database**

Apply via the project's normal migration path (Supabase). Verify the table exists:

Run:
```bash
cd "/Volumes/Crucial/Android Studio" && node -e "
const pg=require('pg');const fs=require('fs');
const u=fs.readFileSync('/Users/GuDenes/Projects/padel-live-scores/.env.local','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).slice(13).replace(/^[\"']|[\"']\$/g,'');
const c=new pg.Client({connectionString:u,ssl:{rejectUnauthorized:false}});
c.connect().then(()=>c.query(\"SELECT to_regclass('padelgod.raw_payload_latest') AS t\")).then(r=>{console.log(r.rows);return c.end();});
"
```
Expected: `[ { t: 'padelgod.raw_payload_latest' } ]`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup
git add supabase/migrations/20260529000001_padelgod_raw_payload_latest.sql
git commit -m "feat(cost): add padelgod.raw_payload_latest dedup state table"
```

---

## Task 2: Dedup-at-write in `runScrapeJob`

**Files:**
- Modify: `padelgod/src/lib/scrape-job.ts` (the `captureBody` block, currently lines 53-66)
- Test: `padelgod/src/__tests__/scrape-job.test.ts`

- [ ] **Step 1: Replace `fakeSupabase` in the test with a dedup-aware stub**

Replace the existing `fakeSupabase` function (lines 5-38) with this version. It adds `select(...).eq(...).maybeSingle()` (returns a configurable `latestRow`) and `upsert(...)` (records calls), while keeping the existing `insert`/`update` chains intact:

```ts
function fakeSupabase(opts: { latestRow?: any } = {}) {
  const inserted: any[] = [];
  const updated: any[] = [];
  const payloads: any[] = [];
  const upserts: any[] = [];
  return {
    inserted, updated, payloads, upserts,
    schema: (_s: string) => ({
      from: (table: string) => ({
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              if (table === 'scrape_jobs') {
                inserted.push({ table, row });
                return { data: { id: 'job-uuid', ...row }, error: null };
              }
              if (table === 'raw_payloads') {
                inserted.push({ table, row });
                payloads.push({ table, row });
                return { data: { id: 'payload-uuid', ...row }, error: null };
              }
              return { data: null, error: { message: 'unexpected' } };
            },
          }),
        }),
        update: (changes: any) => ({
          eq: (col: string, val: any) => {
            updated.push({ table, changes, where: { [col]: val } });
            return { data: null, error: null };
          },
        }),
        upsert: (row: any, _o?: any) => {
          upserts.push({ table, row });
          return { error: null };
        },
        select: (_cols?: string) => {
          const chain: any = {
            eq: () => chain,
            maybeSingle: async () => ({ data: opts.latestRow ?? null, error: null }),
          };
          return chain;
        },
      }),
    }),
  };
}
```

- [ ] **Step 2: Add the dedup test cases**

Append these cases inside the existing `describe('runScrapeJob', ...)` block. They drive `runScrapeJob` end-to-end (no private helpers), controlling the prior state via `fakeSupabase({ latestRow })` and env via `process.env`:

```ts
  const baseOpts = {
    jobType: 'oop' as ScrapeJobType,
    tournamentId: 'tour-uuid',
    targetUrl: 'https://example.com/oop',
    parserVersion: 'test-1.0.0',
    captureBody: true,
  };

  afterEach(() => {
    delete process.env.RAW_PAYLOAD_DEDUP_ENABLED;
    delete process.env.RAW_PAYLOAD_HEARTBEAT_DAYS;
  });

  it('first capture (no prior row) stores body and upserts latest', async () => {
    const sb = fakeSupabase({ latestRow: null });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row.last_content_hash).toBe('h1');
  });

  it('skips storing when hash unchanged within heartbeat', async () => {
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'h1', last_stored_at: new Date().toISOString() },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(0);
    expect(sb.upserts).toHaveLength(0);
  });

  it('stores when hash unchanged but heartbeat elapsed', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'h1', last_stored_at: eightDaysAgo },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
    expect(sb.upserts).toHaveLength(1);
  });

  it('stores when hash changed', async () => {
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'OLD', last_stored_at: new Date().toISOString() },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'NEW' }));
    expect(sb.payloads).toHaveLength(1);
    expect(sb.upserts[0].row.last_content_hash).toBe('NEW');
  });

  it('fail-open: stores when latest lookup errors', async () => {
    const sb: any = fakeSupabase({ latestRow: null });
    // Override select to simulate a lookup error.
    const origSchema = sb.schema;
    sb.schema = (s: string) => {
      const real = origSchema(s);
      return {
        from: (t: string) => {
          const r = real.from(t);
          return {
            ...r,
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
          };
        },
      };
    };
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
  });

  it('dedup disabled: always stores even when hash unchanged', async () => {
    process.env.RAW_PAYLOAD_DEDUP_ENABLED = 'false';
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'h1', last_stored_at: new Date().toISOString() },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
  });
```

Add `afterEach` to the vitest import at the top of the file:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd padelgod && npx vitest run src/__tests__/scrape-job.test.ts`
Expected: FAIL — the new cases fail because `runScrapeJob` still stores unconditionally and never calls `upsert` (e.g. "skips storing when hash unchanged" sees `payloads` length 1, expected 0).

- [ ] **Step 4: Implement the dedup logic in `scrape-job.ts`**

Replace the `captureBody` block (currently lines 53-66) with a call to a new helper, and add the helpers below `runScrapeJob`. The block becomes:

```ts
    if (opts.captureBody && fnResult.body) {
      await maybeStoreRawPayload(supabase, scrapeJobId, opts, fnResult);
    }
```

Add these helpers at the end of the file (after `runScrapeJob`'s closing brace):

```ts
// ── Dedup-at-write for raw_payloads ────────────────────────────────────
//
// raw_payloads is a write-only debug/replay archive. ~93% of historical
// rows were byte-identical re-captures. We skip storing a body that
// matches the target's last stored body, but force a re-store at least
// every RAW_PAYLOAD_HEARTBEAT_DAYS so every active target keeps a body
// younger than the prune retention window. Dedup state lives in
// padelgod.raw_payload_latest, keyed by (job_type, target_url).
//
// Config is read from process.env (not the zod env) because runScrapeJob
// is a shared lib called by ~10 workers; threading flags through every
// caller is impractical. Defaults: enabled, 7-day heartbeat.

function dedupConfig(): { enabled: boolean; heartbeatMs: number } {
  const enabled = process.env.RAW_PAYLOAD_DEDUP_ENABLED !== 'false'; // default on
  const days = Number(process.env.RAW_PAYLOAD_HEARTBEAT_DAYS ?? '7');
  const heartbeatDays = Number.isFinite(days) && days > 0 ? days : 7;
  return { enabled, heartbeatMs: heartbeatDays * 24 * 3600 * 1000 };
}

async function shouldStoreBody(
  supabase: SupabaseClient,
  jobType: string,
  targetUrl: string,
  contentHash: string,
): Promise<boolean> {
  const { enabled, heartbeatMs } = dedupConfig();
  if (!enabled) return true;
  try {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('raw_payload_latest')
      .select('last_content_hash, last_stored_at')
      .eq('job_type', jobType)
      .eq('target_url', targetUrl)
      .maybeSingle();
    if (error) return true;           // fail-open: never drop data on infra error
    if (!data) return true;           // first capture for this target
    if (data.last_content_hash !== contentHash) return true; // content changed
    const lastStored = Date.parse(data.last_stored_at as string);
    if (!Number.isFinite(lastStored)) return true;
    if (Date.now() - lastStored >= heartbeatMs) return true; // heartbeat re-store
    return false;                     // unchanged within heartbeat → skip
  } catch {
    return true;                      // fail-open
  }
}

async function maybeStoreRawPayload(
  supabase: SupabaseClient,
  scrapeJobId: string,
  opts: ScrapeJobOptions,
  fnResult: ScrapeJobFnResult,
): Promise<void> {
  const store = await shouldStoreBody(
    supabase, opts.jobType, opts.targetUrl, fnResult.contentHash,
  );
  if (!store) return;

  const byteSize = Buffer.byteLength(fnResult.body, 'utf8');
  await supabase
    .schema('padelgod')
    .from('raw_payloads')
    .insert({
      scrape_job_id: scrapeJobId,
      content_hash: fnResult.contentHash,
      body: fnResult.body,
      byte_size: byteSize,
    })
    .select()
    .single();

  const { error: upsertErr } = await supabase
    .schema('padelgod')
    .from('raw_payload_latest')
    .upsert(
      {
        job_type: opts.jobType,
        target_url: opts.targetUrl,
        tournament_id: opts.tournamentId,
        last_content_hash: fnResult.contentHash,
        last_stored_at: new Date().toISOString(),
      },
      { onConflict: 'job_type,target_url' },
    );
  if (upsertErr) {
    // Body is already stored; a missed upsert just means a redundant
    // store next cycle. Not worth failing the scrape.
    console.warn(`[scrape-job] raw_payload_latest upsert failed: ${upsertErr.message}`);
  }
}
```

`SupabaseClient` is already imported at the top of the file. `ScrapeJobOptions` and `ScrapeJobFnResult` are already defined in this file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd padelgod && npx vitest run src/__tests__/scrape-job.test.ts`
Expected: PASS — all cases including the 3 original ones (the original "records a successful job" still sees `inserted` length 2, since upserts are tracked separately).

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup
git add padelgod/src/lib/scrape-job.ts padelgod/src/__tests__/scrape-job.test.ts
git commit -m "feat(cost): skip-unchanged dedup with heartbeat for raw_payloads writes"
```

---

## Task 3: `raw-payloads-prune` worker

**Files:**
- Create: `padelgod/src/workers/raw-payloads-prune.ts`
- Test: `padelgod/src/__tests__/workers/raw-payloads-prune.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/__tests__/workers/raw-payloads-prune.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runRawPayloadsPrune } from '../../workers/raw-payloads-prune.js';

// Stub supabase whose `from('raw_payloads')` builder is thenable.
// `selectBatches` are the successive id arrays returned by select().lt().limit();
// `countValue` is returned for the head-count select used in dry-run.
function fakeSupabase(selectBatches: string[][], countValue = 0) {
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
            if (state.op === 'delete') { deletedBatches.push(state.ids); return resolve({ count: state.ids.length, error: null }); }
            return resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    }),
  };
}

describe('runRawPayloadsPrune', () => {
  it('deletes rows older than cutoff across batches', async () => {
    const sb = fakeSupabase([['a', 'b'], ['c']]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.rowsDeleted).toBe(3);
    expect(res.batchesRun).toBe(2);
    expect(sb.deletedBatches).toEqual([['a', 'b'], ['c']]);
    expect(res.hitMaxBatches).toBe(false);
  });

  it('does nothing when no rows are older than cutoff', async () => {
    const sb = fakeSupabase([[]]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 10 });
    expect(res.rowsDeleted).toBe(0);
    expect(res.batchesRun).toBe(0);
    expect(sb.deletedBatches).toEqual([]);
  });

  it('dry-run reports candidate count and deletes nothing', async () => {
    const sb = fakeSupabase([], 42);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: true });
    expect(res.candidateCount).toBe(42);
    expect(res.rowsDeleted).toBe(0);
    expect(sb.deletedBatches).toEqual([]);
  });

  it('stops at maxBatches and flags it', async () => {
    const sb = fakeSupabase([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    const res = await runRawPayloadsPrune({ supabase: sb as any, dryRun: false, batchSize: 2, maxBatches: 2 });
    expect(res.batchesRun).toBe(2);
    expect(res.rowsDeleted).toBe(4);
    expect(res.hitMaxBatches).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/workers/raw-payloads-prune.test.ts`
Expected: FAIL — `Cannot find module '../../workers/raw-payloads-prune.js'`.

- [ ] **Step 3: Implement the worker**

Create `padelgod/src/workers/raw-payloads-prune.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * raw-payloads-prune
 *
 * Retention sweeper for padelgod.raw_payloads — a write-only debug/replay
 * archive (nothing reads body back). Deletes rows older than
 * retentionDays in id-batches to avoid long locks / statement timeouts.
 *
 * Recurring daily prune uses plain DELETE; autovacuum reuses the freed
 * space so steady-state stays flat. The existing ~18 GB backlog is
 * reclaimed to disk by a one-time VACUUM FULL (see the reclaim runbook),
 * NOT by this worker.
 *
 * Pairs with the dedup-at-write logic in lib/scrape-job.ts, which keeps
 * the inflow ~93% smaller. heartbeat (7d) < retention (14d) guarantees
 * every actively-scraped target always has a body younger than the
 * cutoff, so pruning never strands an active target without a body.
 */

export interface RawPayloadsPruneDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** Delete rows older than this many days. Default 14. */
  retentionDays?: number;
  /** Rows per delete batch. Default 10,000. */
  batchSize?: number;
  /** Safety cap on batches per run. Default 500 (covers the ~1.5M-row
   *  first-run backlog at batchSize 10k = ~150 batches). */
  maxBatches?: number;
  /** When true, only count candidates; delete nothing. */
  dryRun: boolean;
}

export interface RawPayloadsPruneResult {
  cutoffIso: string;
  candidateCount: number;
  rowsDeleted: number;
  batchesRun: number;
  hitMaxBatches: boolean;
  dryRun: boolean;
}

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES = 500;

export async function runRawPayloadsPrune(
  deps: RawPayloadsPruneDeps,
): Promise<RawPayloadsPruneResult> {
  const { supabase, logger, dryRun } = deps;
  const retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();

  const result: RawPayloadsPruneResult = {
    cutoffIso,
    candidateCount: 0,
    rowsDeleted: 0,
    batchesRun: 0,
    hitMaxBatches: false,
    dryRun,
  };

  if (dryRun) {
    const { count, error } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .select('id', { count: 'exact', head: true })
      .lt('captured_at', cutoffIso);
    if (error) {
      logger?.warn({ err: error.message }, 'raw-payloads-prune [dry-run]: count failed');
      return result;
    }
    result.candidateCount = count ?? 0;
    logger?.info(result, 'raw-payloads-prune [dry-run]: rows older than cutoff');
    return result;
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .select('id')
      .lt('captured_at', cutoffIso)
      .limit(batchSize);
    if (error) {
      logger?.warn({ err: error.message, batch }, 'raw-payloads-prune: select batch failed');
      break;
    }
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) break;

    const { error: delErr, count } = await supabase
      .schema('padelgod')
      .from('raw_payloads')
      .delete({ count: 'exact' })
      .in('id', ids);
    if (delErr) {
      logger?.warn({ err: delErr.message, batch }, 'raw-payloads-prune: delete batch failed');
      break;
    }

    result.rowsDeleted += count ?? ids.length;
    result.batchesRun += 1;
    if (ids.length < batchSize) break;        // last partial batch
    if (batch === maxBatches - 1) result.hitMaxBatches = true;
  }

  logger?.info(result, 'raw-payloads-prune: done');
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/workers/raw-payloads-prune.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup
git add padelgod/src/workers/raw-payloads-prune.ts padelgod/src/__tests__/workers/raw-payloads-prune.test.ts
git commit -m "feat(cost): add raw-payloads-prune retention worker"
```

---

## Task 4: Scheduler + env wiring

**Files:**
- Modify: `padelgod/src/lib/env.ts` (`EnvSchema`)
- Modify: `padelgod/src/index.ts` (flags object, ~line 168)
- Modify: `padelgod/src/scheduler.ts` (import, `SchedulerFlags`, `WorkerName`, `ALL_WORKERS`, `getWorkerRunner`, `buildSchedule`)

- [ ] **Step 1: Declare env vars in `env.ts`**

In `padelgod/src/lib/env.ts`, inside `EnvSchema`, add alongside the other `ENABLE_*` worker flags (e.g. right after the `FIP_CMS_ORPHAN_PRUNE` entries if present, otherwise with the other prune flags):

```ts
  ENABLE_RAW_PAYLOADS_PRUNE: boolEnv(false),
  RAW_PAYLOADS_PRUNE_DRY_RUN: boolEnv(true),
```

(The dedup vars `RAW_PAYLOAD_DEDUP_ENABLED` / `RAW_PAYLOAD_HEARTBEAT_DAYS` are intentionally NOT added here — they are read from `process.env` directly inside `scrape-job.ts`, per the config-split rationale above.)

- [ ] **Step 2: Add fields to `SchedulerFlags` in `scheduler.ts`**

In the `SchedulerFlags` interface (near the existing `enableFipCmsOrphanPrune` / `fipCmsOrphanPruneDryRun` fields), add:

```ts
  enableRawPayloadsPrune: boolean;
  rawPayloadsPruneDryRun: boolean;
```

- [ ] **Step 3: Thread env → flags in `index.ts`**

In `padelgod/src/index.ts`, in the flags object (near line 168 where `enableFipCmsOrphanPrune: env.ENABLE_FIP_CMS_ORPHAN_PRUNE` is set), add:

```ts
      enableRawPayloadsPrune: env.ENABLE_RAW_PAYLOADS_PRUNE,
      rawPayloadsPruneDryRun: env.RAW_PAYLOADS_PRUNE_DRY_RUN,
```

- [ ] **Step 4: Register the worker name and runner in `scheduler.ts`**

(a) Add the import near the other worker imports at the top:
```ts
import { runRawPayloadsPrune } from './workers/raw-payloads-prune.js';
```

(b) In the `WorkerName` union, add:
```ts
  | 'raw-payloads-prune'
```

(c) In the `ALL_WORKERS` array, add:
```ts
  'raw-payloads-prune',
```

(d) In `getWorkerRunner`'s switch, add a case (admin-trigger default is dry-run-safe, matching the `fip-cms-orphan-prune` precedent):
```ts
    case 'raw-payloads-prune':       return (deps) => runRawPayloadsPrune({
      supabase: deps.supabase,
      logger: deps.logger,
      dryRun: true,
    });
```

- [ ] **Step 5: Register the cron entry in `buildSchedule`**

In `buildSchedule` (near the `flags.enableFipCmsOrphanPrune` block), add:

```ts
  if (flags.enableRawPayloadsPrune) {
    entries.push({
      name: 'raw-payloads-prune',
      // Daily at 03:00 UTC (off-hours). Batched DELETE of raw_payloads
      // rows older than the retention window; DB-only, no external calls.
      cron: '0 3 * * *',
      run: async (deps) => {
        return runRawPayloadsPrune({
          supabase: deps.supabase,
          logger: deps.logger,
          dryRun: flags.rawPayloadsPruneDryRun,
        });
      },
    });
  }
```

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run`
Expected: tsc reports no errors; vitest passes (including the new scrape-job and prune tests). If any existing scheduler test asserts on `ALL_WORKERS.length` or the flags shape, update it to include the new entries.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup
git add padelgod/src/lib/env.ts padelgod/src/index.ts padelgod/src/scheduler.ts
git commit -m "feat(cost): wire raw-payloads-prune into scheduler + env flags"
```

---

## Task 5: Reclaim runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md`

This task ships no code — it documents the operational rollout so the one-time disk reclaim is reproducible. The `VACUUM FULL` is intentionally manual (brief exclusive lock), not part of the worker.

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md`:

````markdown
# raw_payloads cost reclaim — runbook (Pass 1)

One-time rollout for the retention + dedup change. Re-runnable safely.

## Preconditions
- Migration `20260529000001_padelgod_raw_payload_latest.sql` applied.
- Dedup + prune worker code deployed to Railway.

## 0. Baseline audit
```bash
cd "/Volumes/Crucial/Android Studio" && node /tmp/sb-cost-audit.mjs | head -20
```
Record `raw_payloads` total size and the schema totals.

## 1. Confirm dedup is live
After deploy, watch Railway logs / DB: the daily `raw_payloads` insert rate
should drop ~93% within a day. (Dedup defaults on: `RAW_PAYLOAD_DEDUP_ENABLED`
unset or != "false".)

## 2. Prune dry-run
Set Railway env `ENABLE_RAW_PAYLOADS_PRUNE=true`, keep
`RAW_PAYLOADS_PRUNE_DRY_RUN=true`. After the 03:00 UTC run, confirm the log line
`raw-payloads-prune [dry-run]: rows older than cutoff` reports a `candidateCount`
in the expected range (rows with `captured_at` older than 14 days — on first run
~1.5M).

## 3. Prune live
Flip `RAW_PAYLOADS_PRUNE_DRY_RUN=false`. The next 03:00 UTC run batch-deletes the
backlog (~150 batches at 10k). Confirm `rowsDeleted` and that `hitMaxBatches` is
false. (If `hitMaxBatches` is true, the run will continue clearing on subsequent
days; raise `maxBatches` if you want it done in one run.)

## 4. One-time VACUUM FULL (returns disk)
Plain DELETE does not shrink the on-disk file. After the backlog is deleted, run
once in a low-activity window (brief ACCESS EXCLUSIVE lock; safe because
raw_payloads is write-only by background workers and never read by the app):

```bash
cd "/Volumes/Crucial/Android Studio" && node -e "
const pg=require('pg');const fs=require('fs');
const u=fs.readFileSync('/Users/GuDenes/Projects/padel-live-scores/.env.local','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).slice(13).replace(/^[\"']|[\"']\$/g,'');
const c=new pg.Client({connectionString:u,ssl:{rejectUnauthorized:false}});
c.connect()
 .then(()=>{console.log('VACUUM FULL starting...');return c.query('VACUUM FULL padelgod.raw_payloads');})
 .then(()=>c.query('ANALYZE padelgod.raw_payloads'))
 .then(()=>{console.log('done');return c.end();})
 .catch(e=>{console.error(e.message);process.exit(1);});
"
```
`VACUUM FULL` cannot run inside a transaction — `client.query` runs it directly, which is correct.

## 5. Verify
```bash
cd "/Volumes/Crucial/Android Studio" && node /tmp/sb-cost-audit.mjs | head -20
```
Expect `padelgod.raw_payloads` down to ~2–3 GB and the schema total well under
the 24 GB baseline.

## Rollback
- Disable dedup: set `RAW_PAYLOAD_DEDUP_ENABLED=false` (reverts to storing every body).
- Disable prune: set `ENABLE_RAW_PAYLOADS_PRUNE=false`.
Deleted rows are not recoverable, but they are write-only debug artifacts with no
consumer — there is nothing to restore.
````

- [ ] **Step 2: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup
git add docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md
git commit -m "docs(cost): reclaim runbook for raw_payloads retention + dedup"
```

---

## Task 6: Execute the reclaim (operational)

Follow `docs/superpowers/runbooks/2026-05-29-raw-payloads-reclaim.md` end to end against the live database, in order: baseline audit → confirm dedup → prune dry-run → prune live → VACUUM FULL → verify. This is gated on deploying the merged code to Railway and applying the migration to prod. Do not run the live prune or VACUUM FULL until the dry-run candidate count has been eyeballed and looks right.

---

## Notes for the implementer

- **Run from the worktree:** `/Volumes/Crucial/dev/padel-live-scores-worktrees/raw-payloads-retention-dedup`. First-time setup: `cd padelgod && npm install`.
- **ESM import paths:** padelgod uses `.js` extensions in TS imports (e.g. `../../workers/raw-payloads-prune.js`). Keep that convention.
- **Don't thread dedup flags through callers.** Dedup config is read from `process.env` inside `scrape-job.ts` by design.
- **No FK on `raw_payload_latest.tournament_id`** — it's informational; avoiding the FK keeps tournament deletes from bouncing.
- **`raw_payloads` has no dependents** — nothing references it, so the batched DELETE has no cascade concerns.
