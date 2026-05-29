# raw_payloads retention + dedup — Supabase cost Pass 1

**Date:** 2026-05-29
**Branch:** `cost/raw-payloads-retention-dedup`
**Status:** Design approved, pending implementation plan

## Problem

A read-only Supabase storage audit (2026-05-29) found the database is **24 GB**, of which the `padelgod` schema is 24 GB and the entire user-facing `public` schema is only 122 MB (0.5%). The cost is entirely in background-scrape archive tables, not the app.

The dominant table is **`padelgod.raw_payloads` = 20 GB** (2.36M rows):

- Oldest row is **2026-04-20 — only 39 days old**; the table grows **~105k rows/day (~0.5 GB/day compressed)** and roughly doubles monthly. This is the escalating cost the business is feeling.
- **2.36M rows but only 173,641 distinct `content_hash` → ~93% of rows are byte-identical duplicates.** The scraper re-stores the full body every cycle even when the scraped page is unchanged. A `content_hash` column exists for exactly this dedup but is unused.
- The table is **write-only**: nothing in the codebase reads `body` back. The sole reference is the insert at `padelgod/src/lib/scrape-job.ts:53-66`. It is a pure forensic/debug-replay archive whose only consumer is a human manually inspecting a body when a parser breaks.

This is Pass 1 of a phased cost-remediation effort. Passes 2 (`scrape_jobs` retention) and 3 (snapshot-table retention) are out of scope here.

## Decisions (locked with stakeholder)

- **Retention window: 14 days.** Survives a couple weeks of investigation lag; drops the table to ~2-3 GB steady state.
- **Dedup: skip-unchanged with a 7-day heartbeat.** Skip storing a body identical to the target's last stored body, but force-store at least once every 7 days even if unchanged.
- **Dedup state mechanism: a tiny dedicated `raw_payload_latest` table** (Approach A), not querying the giant tables on the write path.

**Key invariant:** heartbeat (7d) < retention (14d) ⇒ every actively-scraped target always has a stored body younger than the prune threshold, so dedup never leaves an active target with no body. Inactive targets (e.g. finished tournaments, no longer scraped) age out entirely — correct, since their bodies are not needed.

## Architecture

Two independent, separately-shippable components plus one one-time ops step:

1. **Dedup-at-write** — stops the inflow of duplicate bodies (the "flow").
2. **Retention prune worker** — caps and reclaims history (the "stock").
3. **One-time `VACUUM FULL`** — actually returns the reclaimed disk to Supabase's measured size (the part that moves the bill).

Both code components follow the existing `fip-cms-orphan-prune` worker conventions: a `dryRun` flag, env toggles, a result-counter object, and vitest stubs.

## Component 1 — migration: `padelgod.raw_payload_latest`

```sql
CREATE TABLE padelgod.raw_payload_latest (
  job_type          text NOT NULL,
  target_url        text NOT NULL,
  tournament_id     uuid,                 -- informational only, not in key
  last_content_hash text NOT NULL,
  last_stored_at    timestamptz NOT NULL,
  PRIMARY KEY (job_type, target_url)
);
```

- Keyed on `(job_type, target_url)` — both are always non-null in `runScrapeJob` (`opts.jobType`, `opts.targetUrl`). `tournament_id` is nullable on `scrape_jobs`, so it cannot be in the primary key; kept as an informational column.
- One row per active scrape target (a few thousand). Never grows with history — bounded.

## Component 2 — dedup-at-write in `runScrapeJob`

File: `padelgod/src/lib/scrape-job.ts`. Replace the unconditional body insert (currently lines 53-66) with a decision:

Look up `raw_payload_latest` by `(job_type, target_url)`. **Store** the body iff one of:

- no prior row exists (first capture for this target), or
- `last_content_hash !== fnResult.contentHash` (content changed), or
- `now - last_stored_at >= heartbeatDays` (default 7, env `RAW_PAYLOAD_HEARTBEAT_DAYS`).

Otherwise **skip** (do nothing — `scrape_jobs` already records that the run happened).

On **store**: insert into `raw_payloads` exactly as today, **and** upsert `raw_payload_latest` with `last_content_hash = contentHash`, `last_stored_at = now()`, `tournament_id = opts.tournamentId`.

Behavioral rules:

- **Fail-open on lookup error:** if the `raw_payload_latest` read errors, store the body anyway. Never drop data because dedup infrastructure hiccupped. Log a warning.
- **Upsert error:** the body is already stored; log a warning and proceed. Worst case is a redundant store next cycle.
- **Kill-switch:** env `RAW_PAYLOAD_DEDUP_ENABLED` (default `true`). When false, behavior reverts to the current unconditional store. Defaulting on is safe because dedup is non-destructive and reversible.
- Respects the existing `opts.captureBody` flag — dedup only applies when `captureBody` is already true.

## Component 3 — `raw-payloads-prune` worker

New worker `padelgod/src/workers/raw-payloads-prune.ts`, structured like `fip-cms-orphan-prune.ts`.

- **Algorithm:** batched delete to avoid long locks / statement timeouts. Loop: select up to `batchSize` ids `WHERE captured_at < now() - retentionDays`, then `delete().in('id', ids)`; repeat until no rows remain or `maxBatches` is hit. (PostgREST `delete` has no `LIMIT`, so the select-ids-then-delete-by-id pattern is required.)
- **Config (deps interface):** `retentionDays` (default 14), `batchSize` (default 10,000), `maxBatches` (safety cap; default high enough to clear the ~1.5M-row first-run backlog, e.g. 500), `dryRun`.
- **Result counters:** `{ rowsDeleted, batchesRun, oldestRemaining, dryRun }`. In `dryRun`, report the candidate count (rows older than cutoff) and delete nothing.
- **Scheduler wiring** (`padelgod/src/scheduler.ts`): add `enableRawPayloadsPrune` + `rawPayloadsPruneDryRun` flags (mirroring `enableFipCmsOrphanPrune` / `fipCmsOrphanPruneDryRun`), register the worker on a daily off-peak cron (`0 3 * * *`).

`raw_payload_latest` is **not** pruned by this worker — it holds only the latest hash per target (used for hash comparison, which doesn't need the body), is tiny, and the heartbeat guarantees a fresh body exists within the retention window for active targets. Pruning stale `raw_payload_latest` rows is out of scope.

## The reclaim nuance (critical for the bill)

A plain `DELETE` marks tuples dead; autovacuum makes that space **reusable** but does **not** shrink the file on disk. So:

- **Recurring daily prune:** plain `DELETE` is sufficient — steady-state stays flat because new inserts reuse freed space. No vacuum needed.
- **One-time backlog reclaim:** after the first live prune clears the ~25-day backlog (~1.5M rows), run a **one-time `VACUUM FULL padelgod.raw_payloads`** to rewrite the remaining ~2 GB and return ~18 GB to disk. It takes a brief `ACCESS EXCLUSIVE` lock — acceptable because the table is write-only by background workers and never read by the app. Run in a low-activity window via the `pg`/`psql` connection (`DATABASE_URL`). `VACUUM FULL` cannot run inside a transaction block.

## Rollout order

1. Ship migration + dedup-at-write. Dedup starts cutting inflow immediately; non-destructive.
2. Ship the prune worker with `rawPayloadsPruneDryRun=true`. Verify the logged candidate count ≈ rows older than 14 days.
3. Flip prune to live. First run clears the backlog.
4. Run the one-time `VACUUM FULL`. Disk drops to ~2-3 GB.
5. Re-run the storage audit to confirm.

## Error handling summary

| Failure | Behavior |
|---|---|
| Dedup lookup errors | Fail-open: store the body, log warning |
| Dedup upsert errors | Log warning, proceed (body already stored) |
| Prune batch delete errors | Stop the run, report partial counts; next daily run resumes |
| `VACUUM FULL` | Manual ops step, monitored by hand |

## Testing

**Unit (vitest, supabase stub mirroring existing worker tests):**

- Dedup in `runScrapeJob`:
  - (a) first capture (no prior row) → stores body + upserts `raw_payload_latest`
  - (b) unchanged hash within heartbeat → skip (no insert)
  - (c) unchanged hash past heartbeat → store (heartbeat re-store)
  - (d) changed hash → store + upsert
  - (e) lookup error → fail-open store
  - (f) `RAW_PAYLOAD_DEDUP_ENABLED=false` → always store (current behavior)
- Prune worker:
  - (a) deletes rows older than cutoff in batches
  - (b) keeps rows within the window
  - (c) `dryRun` deletes nothing but reports candidate count
  - (d) stops at `maxBatches` cap

**Manual:**

- Prune dry-run against prod confirms candidate count ≈ rows older than 14 days.
- After enabling dedup, confirm the `raw_payloads` daily insert count drops ~93% (skip rate) over the following day.
- After the full rollout, re-run the storage audit; expect `raw_payloads` ~2-3 GB.

## Out of scope

- `scrape_jobs` retention + the redundant `idx_scrape_jobs_recent` drop (Pass 2).
- Snapshot-table retention preserving latest-per-(tournament, category) for `results_snapshots` / `oop_snapshots` / `entry_list_snapshots` / `draw_snapshots` (Pass 3).
- Pruning stale `raw_payload_latest` rows (tiny table, ignore).
- A content-addressed body store (storing each distinct body once, referenced by hash) — heavier schema change; skip-unchanged + heartbeat achieves the savings without it.
- Confirming the Supabase invoice's disk-vs-egress-vs-compute split (needs the usage dashboard; disk is the most likely driver at 24 GB).
